package com.easychat.websocket;

import com.easychat.entity.dto.MessageSendDto;
import com.easychat.entity.enums.UserContactTypeEnum;
import com.easychat.service.ChatEventOutboxService;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;

/**
 * Publishes explicit V2 domain events into the transactional outbox.
 *
 * This class intentionally contains no DTO/messageType inference. A domain
 * write must select its contract at the call site, which makes a newly added
 * business action fail code review rather than silently becoming an unknown
 * WebSocket event.
 */
@Component
public class DomainEventPublisher {
    @Resource
    private ChatEventOutboxService chatEventOutboxService;

    public void messageUpsert(MessageSendDto payload) {
        publish("MESSAGE_UPSERT", payload);
    }

    public void mediaStatus(MessageSendDto payload) {
        publish("MEDIA_STATUS", payload);
    }

    public void contactChanged(MessageSendDto payload) {
        publish("CONTACT_CHANGED", payload);
    }

    public void groupChanged(MessageSendDto payload) {
        publish("GROUP_CHANGED", payload);
    }

    public void contactApplyChanged(MessageSendDto payload) {
        publish("CONTACT_APPLY_CHANGED", payload);
    }

    public void sessionReplaced(MessageSendDto payload) {
        publish("SESSION_REPLACED", payload);
    }

    private void publish(String eventType, MessageSendDto payload) {
        if (payload == null || payload.getContactId() == null || payload.getContactId().trim().isEmpty()) {
            throw new IllegalArgumentException("V2 event target is required");
        }
        UserContactTypeEnum contactType = UserContactTypeEnum.getByPrefix(payload.getContactId());
        if (contactType == null) {
            throw new IllegalArgumentException("Unsupported V2 event target");
        }
        long occurredAt = payload.getSendTime() == null ? System.currentTimeMillis() : payload.getSendTime();
        chatEventOutboxService.enqueueEvent(eventType, contactType.name(), payload.getContactId(), payload, occurredAt);
    }
}
