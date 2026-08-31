package com.easychat.websocket;

import com.alibaba.fastjson.JSON;
import com.easychat.entity.constants.Constants;
import com.easychat.entity.dto.MessageSendDto;
import com.easychat.entity.dto.WsInitData;
import com.easychat.entity.enums.MessageTypeEnum;
import com.easychat.entity.enums.UserContactApplyStatusEnum;
import com.easychat.entity.enums.UserContactTypeEnum;
import com.easychat.entity.po.*;
import com.easychat.entity.query.*;
import com.easychat.mappers.*;
import com.easychat.redis.RedisComponet;
import com.easychat.utils.JsonUtils;
import com.easychat.utils.StringTools;
import io.netty.channel.Channel;
import io.netty.channel.group.ChannelGroup;
import io.netty.channel.group.DefaultChannelGroup;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.util.Attribute;
import io.netty.util.AttributeKey;
import io.netty.util.concurrent.GlobalEventExecutor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.stream.Collectors;

@Component("channelContextUtils")
public class ChannelContextUtils {

    private static final Logger logger = LoggerFactory.getLogger(ChannelContextUtils.class);

    @Resource
    private RedisComponet redisComponet;

    public static final ConcurrentMap<String, Channel> USER_CONTEXT_MAP = new ConcurrentHashMap();

    public static final ConcurrentMap<String, ChannelGroup> GROUP_CONTEXT_MAP = new ConcurrentHashMap();

    @Resource
    private ChatSessionUserMapper<ChatSessionUser, ChatSessionUserQuery> chatSessionUserMapper;

    @Resource
    private ChatMessageMapper<ChatMessage, ChatMessageQuery> chatMessageMapper;

    @Resource
    private UserInfoMapper<UserInfo, UserInfoQuery> userInfoMapper;

    @Resource
    private UserContactMapper<UserContact, UserContactQuery> userContactMapper;

    @Resource
    private UserContactApplyMapper<UserContactApply, UserContactApplyQuery> userContactApplyMapper;

    /**
     * 鍔犲叆閫氶亾
     *
     * @param userId
     * @param channel
     */
    public void addContext(String userId, Channel channel) {
        try {
            String channelId = channel.id().toString();
            AttributeKey attributeKey = null;
            if (!AttributeKey.exists(channelId)) {
                attributeKey = AttributeKey.newInstance(channel.id().toString());
            } else {
                attributeKey = AttributeKey.valueOf(channel.id().toString());
            }
            channel.attr(attributeKey).set(userId);

            List<String> contactList = redisComponet.getUserContactList(userId);
            for (String groupId : contactList) {
                if (groupId.startsWith(UserContactTypeEnum.GROUP.getPrefix())) {
                    add2Group(groupId, channel);
                }
            }
            Channel previousChannel = USER_CONTEXT_MAP.put(userId, channel);
            if (previousChannel != null && previousChannel != channel) {
                previousChannel.close();
            }
            redisComponet.saveUserHeartBeat(userId);

            //鏇存柊鐢ㄦ埛鏈€鍚庤繛鎺ユ椂闂?
            UserInfo updateInfo = new UserInfo();
            updateInfo.setLastLoginTime(new Date());
            userInfoMapper.updateByUserId(updateInfo, userId);

            //缁欑敤鎴峰彂閫佷竴浜涙秷鎭?
            //鑾峰彇鐢ㄦ埛鏈€鍚庣绾挎椂闂?
            if (legacyInitEnabled()) {
            UserInfo userInfo = userInfoMapper.selectByUserId(userId);
            Long sourceLastOffTime = userInfo.getLastOffTime();
            //杩欓噷閬垮厤姣鏃堕棿宸紝鎵€浠ュ噺鍘?绉掔殑鏃堕棿
            //濡傛灉鏃堕棿澶箙锛屽彧鍙栨渶杩戜笁澶╃殑娑堟伅鏁?
            Long lastOffTime = sourceLastOffTime;
            if (sourceLastOffTime != null && System.currentTimeMillis() - Constants.MILLISECOND_3DAYS_AGO > sourceLastOffTime) {
                lastOffTime = System.currentTimeMillis() - Constants.MILLISECOND_3DAYS_AGO;
            }

            /**
             * 1銆佹煡璇細璇濅俊鎭?鏌ヨ鐢ㄦ埛鎵€鏈変細璇濓紝閬垮厤鎹㈣澶囦細璇濅笉鍚屾
             */
            ChatSessionUserQuery sessionUserQuery = new ChatSessionUserQuery();
            sessionUserQuery.setUserId(userId);
            sessionUserQuery.setOrderBy("last_receive_time desc");
            List<ChatSessionUser> chatSessionList = chatSessionUserMapper.selectList(sessionUserQuery);
            WsInitData wsInitData = new WsInitData();
            wsInitData.setChatSessionList(chatSessionList);

            /**
             * 2銆佹煡璇㈣亰澶╂秷鎭?
             */
            //鏌ヨ鐢ㄦ埛鐨勮仈绯讳汉
            UserContactQuery contactQuery = new UserContactQuery();
            contactQuery.setContactType(UserContactTypeEnum.GROUP.getType());
            contactQuery.setUserId(userId);
            List<UserContact> groupContactList = userContactMapper.selectList(contactQuery);
            List<String> groupIdList = groupContactList.stream().map(item -> item.getContactId()).collect(Collectors.toList());
            //灏嗚嚜宸变篃鍔犺繘鍘?
            groupIdList.add(userId);

            ChatMessageQuery messageQuery = new ChatMessageQuery();
            messageQuery.setContactIdList(groupIdList);
            messageQuery.setLastReceiveTime(lastOffTime);
            List<ChatMessage> chatMessageList = chatMessageMapper.selectList(messageQuery);
            wsInitData.setChatMessageList(chatMessageList);

            /**
             * 3銆佹煡璇㈠ソ鍙嬬敵璇?
             */
            UserContactApplyQuery applyQuery = new UserContactApplyQuery();
            applyQuery.setReceiveUserId(userId);
            applyQuery.setLastApplyTimestamp(sourceLastOffTime);
            applyQuery.setStatus(UserContactApplyStatusEnum.INIT.getStatus());
            Integer applyCount = userContactApplyMapper.selectCount(applyQuery);
            wsInitData.setApplyCount(applyCount);

            //鍙戦€佹秷鎭?
            MessageSendDto messageSendDto = new MessageSendDto();
            messageSendDto.setMessageType(MessageTypeEnum.INIT.getType());
            messageSendDto.setContactId(userId);
            messageSendDto.setExtendData(wsInitData);

            // V2 connection setup must not publish a legacy INIT payload.
            // The client performs durable reconciliation via /chat/syncEvents.
            }
        } catch (Exception e) {
            logger.error("初始化连接失败", e);
        }
    }

    /** Kept only to preserve source compatibility while old INIT is retired. */
    private boolean legacyInitEnabled() {
        return false;
    }

    /**
     * 鍒犻櫎閫氶亾杩炴帴寮傚父
     *
     * @param channel
     */
    public void removeContext(Channel channel) {
        Attribute<String> attribute = channel.attr(AttributeKey.valueOf(channel.id().toString()));
        String userId = attribute.get();
        // A rejected or unauthenticated handshake has no user binding.  In
        // particular it must not remove a Redis heartbeat or update a blank
        // user record while its channel is being closed.
        if (StringTools.isEmpty(userId)) {
            return;
        }
        USER_CONTEXT_MAP.remove(userId, channel);
        redisComponet.removeUserHeartBeat(userId);

        //鏇存柊鐢ㄦ埛鏈€鍚庢柇绾挎椂闂?
        UserInfo userInfo = new UserInfo();
        userInfo.setLastOffTime(System.currentTimeMillis());
        userInfoMapper.updateByUserId(userInfo, userId);
    }

    public void closeContext(String userId) {
        if (StringTools.isEmpty(userId)) {
            return;
        }
        redisComponet.cleanUserTokenByUserId(userId);
        Channel channel = USER_CONTEXT_MAP.get(userId);
        USER_CONTEXT_MAP.remove(userId);
        if (channel != null) {
            channel.close();
        }
    }

    /** Routes an immutable V2 envelope. Unlike legacy routing, this never mutates its payload. */
    public void routeV2Event(String targetType, String targetId, String envelope) {
        if ("GROUP".equals(targetType)) {
            ChannelGroup group = GROUP_CONTEXT_MAP.get(targetId);
            if (group != null) {
                group.writeAndFlush(new TextWebSocketFrame(envelope));
            }
            return;
        }
        Channel channel = USER_CONTEXT_MAP.get(targetId);
        if (channel != null) {
            channel.writeAndFlush(new TextWebSocketFrame(envelope));
        }
    }

    /**
     * 鍙戦€佹秷鎭粰鐢ㄦ埛
     */
    private void send2User(MessageSendDto messageSendDto) {
        String contactId = messageSendDto.getContactId();
        sendMsg(messageSendDto, contactId);
        //寮哄埗涓嬬嚎
        if (MessageTypeEnum.FORCE_OFF_LINE.getType().equals(messageSendDto.getMessageType())) {
            closeContext(contactId);
        }
    }

    /**
     * 鍙戦€佹秷鎭埌缁?
     */
    private void sendMsg2Group(MessageSendDto messageSendDto) {
        if (messageSendDto.getContactId() == null) {
            return;
        }

        ChannelGroup group = GROUP_CONTEXT_MAP.get(messageSendDto.getContactId());
        if (group == null) {
            return;
        }
        group.writeAndFlush(new TextWebSocketFrame(JSON.toJSONString(messageSendDto)));

        //绉婚櫎缇よ亰
        MessageTypeEnum messageTypeEnum = MessageTypeEnum.getByType(messageSendDto.getMessageType());
        if (MessageTypeEnum.LEAVE_GROUP == messageTypeEnum || MessageTypeEnum.REMOVE_GROUP == messageTypeEnum) {
            String userId = (String) messageSendDto.getExtendData();
            redisComponet.removeUserContact(userId, messageSendDto.getContactId());
            Channel channel = USER_CONTEXT_MAP.get(userId);
            if (channel == null) {
                return;
            }
            group.remove(channel);
        }

        if (MessageTypeEnum.DISSOLUTION_GROUP == messageTypeEnum) {
            GROUP_CONTEXT_MAP.remove(messageSendDto.getContactId());
            group.close();
        }
    }


    private static void sendMsg(MessageSendDto messageSendDto, String reciveId) {
        if (reciveId == null) {
            return;
        }
        Channel sendChannel = USER_CONTEXT_MAP.get(reciveId);
        if (sendChannel == null) {
            return;
        }
        //鐩稿綋浜庡鎴疯€岃█锛岃仈绯讳汉灏辨槸鍙戦€佷汉锛屾墍浠ヨ繖閲岃浆鎹竴涓嬪啀鍙戦€?濂藉弸鎵撴嫑鍛间俊鎭彂閫佺粰鑷繁闇€瑕佺壒娈婂鐞?
        if (MessageTypeEnum.ADD_FRIEND_SELF.getType().equals(messageSendDto.getMessageType())) {
            UserInfo userInfo = (UserInfo) messageSendDto.getExtendData();
            messageSendDto.setMessageType(MessageTypeEnum.ADD_FRIEND.getType());
            messageSendDto.setContactId(userInfo.getUserId());
            messageSendDto.setContactName(userInfo.getNickName());
            messageSendDto.setExtendData(null);
        } else {
            messageSendDto.setContactId(messageSendDto.getSendUserId());
            messageSendDto.setContactName(messageSendDto.getSendUserNickName());
        }
        sendChannel.writeAndFlush(new TextWebSocketFrame(JsonUtils.convertObj2Json(messageSendDto)));
    }

    private void add2Group(String groupId, Channel context) {
        ChannelGroup group = GROUP_CONTEXT_MAP.get(groupId);
        if (group == null) {
            group = new DefaultChannelGroup(GlobalEventExecutor.INSTANCE);
            GROUP_CONTEXT_MAP.put(groupId, group);
        }
        if (context == null) {
            return;
        }
        group.add(context);
    }

    public void addUser2Group(String userId, String groupId) {
        Channel channel = USER_CONTEXT_MAP.get(userId);
        add2Group(groupId, channel);
    }
}


