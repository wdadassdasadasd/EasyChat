package com.easychat.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.easychat.entity.dto.MessageSendDto;
import com.easychat.entity.enums.UserContactTypeEnum;
import com.easychat.entity.enums.ResponseCodeEnum;
import com.easychat.exception.BusinessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Persists the immutable V2 event in the same transaction as the message.
 * Delivery is deliberately handled by a separate dispatcher after commit.
 */
@Service
public class ChatEventOutboxService {
    @Resource
    private JdbcTemplate jdbcTemplate;

    public void enqueueMessage(MessageSendDto message) {
        enqueueEvent("MESSAGE_UPSERT", UserContactTypeEnum.getByPrefix(message.getContactId()).name(), message.getContactId(), message, message.getSendTime());
    }

    /** Persists a complete immutable V2 envelope. Callers must invoke this inside their write transaction. */
    public void enqueueEvent(String type, String targetType, String targetId, Object payload, long occurredAt) {
        String eventId = UUID.randomUUID().toString();
        long now = System.currentTimeMillis();
        // Reserve the sequence first.  The final JSON is written before the
        // surrounding message transaction commits, so consumers only ever see
        // a complete immutable V2 envelope.
        jdbcTemplate.update("insert into chat_event_outbox(event_id,event_type,target_type,target_id,payload,status,retry_count,created_at,occurred_at) values(?,?,?,?,?,'PENDING',0,?,?)",
                eventId, type, targetType, targetId, "{}", now, occurredAt);
        Long serverSequence = jdbcTemplate.queryForObject(
                "select server_sequence from chat_event_outbox where event_id=?", Long.class, eventId);
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("version", 2);
        envelope.put("eventId", eventId);
        envelope.put("serverSequence", serverSequence);
        envelope.put("type", type);
        envelope.put("occurredAt", occurredAt);
        envelope.put("payload", payload);
        jdbcTemplate.update("update chat_event_outbox set payload=? where event_id=?",
                JSON.toJSONString(envelope), eventId);
    }

    public Map<String, Object> syncEvents(String userId, long cursor, int limit) {
        int pageSize = Math.max(1, Math.min(limit, 200));
        Long oldestRetained = jdbcTemplate.queryForObject(
                "select min(server_sequence) from chat_event_outbox where occurred_at>=?",
                Long.class, retentionStart());
        if (oldestRetained != null && cursor < oldestRetained - 1) {
            Map<String, Object> expired = new LinkedHashMap<>();
            expired.put("cursorExpired", true);
            expired.put("reason", "CURSOR_EXPIRED");
            expired.put("events", new ArrayList<>());
            expired.put("nextCursor", cursor);
            expired.put("hasMore", false);
            expired.put("unreadSnapshot", unreadSnapshot(userId));
            return expired;
        }
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "select e.server_sequence,e.payload from chat_event_outbox e where e.server_sequence>? and (" +
                        "(e.target_type='USER' and e.target_id=?) or " +
                        "(e.target_type='GROUP' and exists(select 1 from user_contact c where c.user_id=? and c.contact_id=e.target_id and c.status=1))" +
                        ") order by e.server_sequence limit ?",
                cursor, userId, userId, pageSize + 1);
        boolean hasMore = rows.size() > pageSize;
        if (hasMore) rows.remove(rows.size() - 1);
        List<JSONObject> events = new ArrayList<>();
        long nextCursor = cursor;
        for (Map<String, Object> row : rows) {
            JSONObject envelope = JSON.parseObject(String.valueOf(row.get("payload")));
            long sequence = ((Number) row.get("server_sequence")).longValue();
            envelope.put("serverSequence", sequence);
            events.add(envelope);
            nextCursor = sequence;
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("events", events);
        response.put("nextCursor", nextCursor);
        response.put("hasMore", hasMore);
        response.put("unreadSnapshot", unreadSnapshot(userId));
        return response;
    }

    /** A bounded recovery view; older history remains available through chat pagination. */
    public Map<String, Object> syncSnapshot(String userId, Long requestedWatermark, String sessionCursor) {
        long currentWatermark = maxSequence();
        // A client never chooses a cursor beyond the server's durable event
        // waterline; clamping prevents a malformed resume request from
        // acknowledging future events.
        long snapshotCursor = requestedWatermark == null || requestedWatermark < 0
                ? currentWatermark : Math.min(requestedWatermark, currentWatermark);
        Object[] cursor = decodeSessionCursor(sessionCursor);
        String where = "u.user_id=?";
        List<Object> args = new ArrayList<>();
        args.add(userId);
        if (cursor != null) {
            where += " and (c.last_receive_time<? or (c.last_receive_time=? and u.session_id>?))";
            args.add(cursor[0]); args.add(cursor[0]); args.add(cursor[1]);
        }
        args.add(51);
        List<Map<String, Object>> sessions = jdbcTemplate.queryForList(
                "select u.contact_id as contactId,u.session_id as sessionId,u.contact_name as contactName," +
                        "c.last_message as lastMessage,c.last_receive_time as lastReceiveTime," +
                        "coalesce(u.no_read_count,0) as noReadCount," +
                        "case when substring(u.contact_id,1,1)='G' then " +
                        "(select count(1) from user_contact uc where uc.contact_id=u.contact_id and uc.status=1) else 0 end as memberCount " +
                        "from chat_session_user u inner join chat_session c on c.session_id=u.session_id where " + where +
                        " order by c.last_receive_time desc,u.session_id asc limit ?", args.toArray());
        boolean hasMore = sessions.size() > 50;
        if (hasMore) sessions.remove(sessions.size() - 1);
        List<Map<String, Object>> messages = new ArrayList<>();
        for (Map<String, Object> session : sessions) {
            List<Map<String, Object>> recent = jdbcTemplate.queryForList(
                    "select message_id as messageId,client_message_id as clientMessageId,session_id as sessionId," +
                            "message_type as messageType,message_content as messageContent,send_user_id as sendUserId," +
                            "send_user_nick_name as sendUserNickName,send_time as sendTime,contact_id as contactId," +
                            "contact_type as contactType,file_size as fileSize,file_name as fileName,file_type as fileType,status " +
                            "from chat_message where session_id=? order by message_id desc limit 100",
                    session.get("sessionId"));
            // The client inserts in chronological order, even though the SQL
            // limit is selected from the tail for efficiency.
            for (int index = recent.size() - 1; index >= 0; index--) {
                messages.add(recent.get(index));
            }
        }
        String nextSessionCursor = null;
        if (hasMore && !sessions.isEmpty()) {
            Map<String, Object> last = sessions.get(sessions.size() - 1);
            nextSessionCursor = encodeSessionCursor(last.get("lastReceiveTime"), last.get("sessionId"));
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("sessions", sessions);
        response.put("messages", messages);
        response.put("snapshotCursor", snapshotCursor);
        response.put("nextSessionCursor", nextSessionCursor);
        response.put("hasMore", hasMore);
        response.put("unreadSnapshot", unreadSnapshot(userId));
        return response;
    }

    @Transactional(rollbackFor = Exception.class)
    public void markRead(String userId, String contactId, String requestId) {
        Integer visible = jdbcTemplate.queryForObject(
                "select count(1) from user_contact where user_id=? and contact_id=? and status=1",
                Integer.class, userId, contactId);
        if (visible == null || visible == 0) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        int inserted = jdbcTemplate.update("insert ignore into chat_read_receipt(user_id,read_request_id,contact_id,created_at) values(?,?,?,?)",
                userId, requestId, contactId, System.currentTimeMillis());
        if (inserted == 0) {
            String recordedContact = jdbcTemplate.queryForObject(
                    "select contact_id from chat_read_receipt where user_id=? and read_request_id=?",
                    String.class, userId, requestId);
            if (!contactId.equals(recordedContact)) {
                throw new BusinessException(ResponseCodeEnum.CODE_600);
            }
            return;
        }
        jdbcTemplate.update("update chat_session_user set no_read_count=0 where user_id=? and contact_id=?", userId, contactId);
    }

    public void incrementUnreadForVisibleMessage(MessageSendDto message) {
        if (UserContactTypeEnum.USER == UserContactTypeEnum.getByPrefix(message.getContactId())) {
            jdbcTemplate.update("update chat_session_user set no_read_count=coalesce(no_read_count,0)+1 where user_id=? and contact_id=?",
                    message.getContactId(), message.getSendUserId());
        } else {
            jdbcTemplate.update("update chat_session_user set no_read_count=coalesce(no_read_count,0)+1 where contact_id=? and user_id<>?",
                    message.getContactId(), message.getSendUserId());
        }
    }

    private long maxSequence() {
        Long value = jdbcTemplate.queryForObject("select coalesce(max(server_sequence),0) from chat_event_outbox", Long.class);
        return value == null ? 0L : value;
    }

    private String encodeSessionCursor(Object time, Object sessionId) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString((String.valueOf(time) + "|" + sessionId).getBytes(StandardCharsets.UTF_8));
    }

    private Object[] decodeSessionCursor(String cursor) {
        if (cursor == null || cursor.trim().isEmpty()) return null;
        try {
            String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
            int delimiter = raw.lastIndexOf('|');
            if (delimiter <= 0) return null;
            return new Object[]{Long.parseLong(raw.substring(0, delimiter)), raw.substring(delimiter + 1)};
        } catch (Exception ignored) { return null; }
    }

    private Map<String, Object> unreadSnapshot(String userId) {
        Map<String, Object> unreadSnapshot = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(
                "select contact_id,no_read_count from chat_session_user where user_id=?", userId)) {
            unreadSnapshot.put(String.valueOf(row.get("contact_id")), row.get("no_read_count"));
        }
        return unreadSnapshot;
    }

    private long retentionStart() {
        return System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000;
    }
}
