package com.easychat.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.easychat.websocket.ChannelContextUtils;
import org.redisson.api.RStream;
import org.redisson.api.RedissonClient;
import org.redisson.api.StreamMessageId;
import org.redisson.api.PendingEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.ArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/** Redis Streams bridge. Duplicate stream records are safe because eventId is durable. */
@Component
public class ChatEventOutboxDispatcher {
    private static final Logger logger = LoggerFactory.getLogger(ChatEventOutboxDispatcher.class);
    private static final String STREAM = "easychat:event:v2";
    @Resource private JdbcTemplate jdbcTemplate;
    @Resource private RedissonClient redissonClient;
    @Resource private ChannelContextUtils channelContextUtils;
    @Value("${easychat.instance-id:${EASYCHAT_INSTANCE_ID:}}") private String instanceId;
    @Value("${easychat.outbox.stream-max-length:100000}") private int streamMaxLength;
    @Value("${easychat.outbox.pending-idle-ms:30000}") private long pendingIdleMs;
    private String consumer;
    private String group;
    private final AtomicLong publishFailures = new AtomicLong();
    private final AtomicLong leaseExpirations = new AtomicLong();
    private final AtomicLong pendingClaims = new AtomicLong();

    @PostConstruct
    public void initialize() {
        if (instanceId == null || instanceId.trim().isEmpty()) {
            throw new IllegalStateException("EASYCHAT_INSTANCE_ID is required for V2 event delivery");
        }
        consumer = instanceId + "-" + UUID.randomUUID().toString();
        group = "easychat-v2-" + instanceId;
        try {
            redissonClient.<String, String>getStream(STREAM).createGroup(group, StreamMessageId.NEWEST);
        } catch (Exception ignored) {
            // BUSYGROUP means this instance is restarting and must recover pending records.
        }
    }

    @Scheduled(fixedDelayString = "${easychat.outbox.dispatch-delay-ms:200}")
    public void publishPending() {
        long now = System.currentTimeMillis();
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "select event_id,server_sequence,target_type,target_id,payload,retry_count,status from chat_event_outbox where " +
                        "((status='PENDING' and (next_attempt_at is null or next_attempt_at<=?)) or " +
                        "(status='PROCESSING' and lease_until<?)) and created_at>=? order by server_sequence limit 100",
                now, now, now - 30L * 24 * 60 * 60 * 1000);
        RStream<String, String> stream = redissonClient.getStream(STREAM);
        for (Map<String, Object> row : rows) {
            String eventId = (String) row.get("event_id");
            boolean reclaimingExpiredLease = "PROCESSING".equals(row.get("status"));
            int claimed = jdbcTemplate.update("update chat_event_outbox set status='PROCESSING',retry_count=retry_count+1,lease_until=?,next_attempt_at=null where event_id=? and " +
                            "((status='PENDING' and (next_attempt_at is null or next_attempt_at<=?)) or (status='PROCESSING' and lease_until<?))",
                    now + 30000, eventId, now, now);
            if (claimed != 1) continue;
            if (reclaimingExpiredLease) leaseExpirations.incrementAndGet();
            try {
                Map<String, String> record = new HashMap<>();
                record.put("eventId", eventId);
                record.put("serverSequence", String.valueOf(row.get("server_sequence")));
                record.put("targetType", String.valueOf(row.get("target_type")));
                record.put("targetId", String.valueOf(row.get("target_id")));
                record.put("envelope", String.valueOf(row.get("payload")));
                stream.addAll(record);
                if (streamMaxLength > 0) stream.trimNonStrict(streamMaxLength);
                jdbcTemplate.update("update chat_event_outbox set status='PUBLISHED',published_at=?,lease_until=null,next_attempt_at=null where event_id=?", System.currentTimeMillis(), eventId);
            } catch (Exception error) {
                long retry = ((Number) row.get("retry_count")).longValue() + 1;
                long delay = Math.min(60000L, 1000L * (1L << Math.min(6L, retry)));
                publishFailures.incrementAndGet();
                logger.warn("event outbox publish failed eventId={} retry={} retryDelayMs={}", eventId, retry, delay, error);
                jdbcTemplate.update("update chat_event_outbox set status='PENDING',lease_until=null,next_attempt_at=? where event_id=?", now + delay, eventId);
            }
        }
    }

    @Scheduled(fixedDelayString = "${easychat.outbox.consume-delay-ms:100}")
    public void consumeForThisNode() {
        RStream<String, String> stream = redissonClient.getStream(STREAM);
        try {
            recoverPending(stream);
            consume(stream, stream.readGroup(group, consumer, 100, StreamMessageId.ALL));
            consume(stream, stream.readGroup(group, consumer, 100, StreamMessageId.NEVER_DELIVERED));
        } catch (Exception error) {
            logger.warn("event stream consume failed group={}", group, error);
        }
    }

    private void consume(RStream<String, String> stream, Map<StreamMessageId, Map<String, String>> records) {
        for (Map.Entry<StreamMessageId, Map<String, String>> record : records.entrySet()) {
            try {
                String targetType = record.getValue().get("targetType");
                String targetId = record.getValue().get("targetId");
                String envelope = record.getValue().get("envelope");
                if (targetType == null || targetId == null || envelope == null) {
                    throw new IllegalArgumentException("incomplete V2 stream record");
                }
                channelContextUtils.routeV2Event(targetType, targetId, envelope);
                stream.ack(group, record.getKey());
            } catch (Exception error) {
                logger.warn("event stream routing failed eventId={}", record.getValue().get("eventId"), error);
            }
        }
    }

    /**
     * A consumer name changes on process restart.  Claim only entries whose
     * owner has been idle long enough, then route/ACK through the same path as
     * new records.  eventId de-duplication is performed by SQLite clients.
     */
    private void recoverPending(RStream<String, String> stream) {
        List<PendingEntry> pending = stream.listPending(group, StreamMessageId.MIN, StreamMessageId.MAX, 100);
        List<StreamMessageId> claimIds = new ArrayList<>();
        for (PendingEntry entry : pending) {
            if (entry.getIdleTime() >= pendingIdleMs) claimIds.add(entry.getId());
        }
        if (claimIds.isEmpty()) return;
        Map<StreamMessageId, Map<String, String>> claimed = stream.claim(group, consumer, pendingIdleMs,
                TimeUnit.MILLISECONDS, claimIds.toArray(new StreamMessageId[0]));
        pendingClaims.addAndGet(claimed.size());
        logger.info("event stream pending claimed group={} count={} pendingClaims={} publishFailures={} leaseExpirations={}",
                group, claimed.size(), pendingClaims.get(), publishFailures.get(), leaseExpirations.get());
        consume(stream, claimed);
    }

    @Scheduled(cron = "0 10 3 * * *")
    public void deleteExpired() {
        jdbcTemplate.update("delete from chat_event_outbox where occurred_at < ?", System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000);
    }
}
