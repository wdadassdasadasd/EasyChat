package com.easychat.websocket.netty;

import com.easychat.entity.dto.TokenUserInfoDto;
import com.easychat.redis.RedisComponet;
import com.easychat.utils.StringTools;
import com.easychat.websocket.ChannelContextUtils;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.codec.http.websocketx.CloseWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
import io.netty.util.Attribute;
import io.netty.util.AttributeKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Value;

/**
 * @Description ws 业务处理
 * @Author 程序员老罗
 * @Date 2023/12/17 10:10
 */

/**
 * 设置通道共享
 */
@ChannelHandler.Sharable
@Component("handlerWebSocket")
public class HandlerWebSocket extends SimpleChannelInboundHandler<TextWebSocketFrame> {

    private static final Logger logger = LoggerFactory.getLogger(HandlerWebSocket.class);
    private static final AtomicInteger ACTIVE_CONNECTIONS = new AtomicInteger();
    private static final AttributeKey<Boolean> CONNECTION_COUNTED = AttributeKey.valueOf("easychat.ws.counted");

    @Value("${easychat.ws.max-connections:10000}")
    private int maxConnections;

    @Resource
    private ChannelContextUtils channelContextUtils;

    @Resource
    private RedisComponet redisComponet;

    /**
     * 当通道就绪后会调用此方法，通常我们会在这里做一些初始化操作
     *
     * @param ctx
     * @throws Exception
     */
    @Override
    public void channelActive(ChannelHandlerContext ctx) throws Exception {
        int active = ACTIVE_CONNECTIONS.incrementAndGet();
        if (active > maxConnections) {
            ACTIVE_CONNECTIONS.decrementAndGet();
            logger.warn("Rejecting WebSocket connection because local limit was reached: {}", maxConnections);
            ctx.close();
            return;
        }
        ctx.channel().attr(CONNECTION_COUNTED).set(Boolean.TRUE);
        // Channel channel = ctx.channel();
        logger.info("有新的连接加入。。。");
    }

    /**
     * 当通道不再活跃时（连接关闭）会调用此方法，我们可以在这里做一些清理工作
     *
     * @param ctx
     * @throws Exception
     */
    @Override
    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
        logger.info("有连接已经断开。。。");
        channelContextUtils.removeContext(ctx.channel());
        if (Boolean.TRUE.equals(ctx.channel().attr(CONNECTION_COUNTED).getAndSet(Boolean.FALSE))) {
            ACTIVE_CONNECTIONS.decrementAndGet();
        }
    }

    /**
     * 读就绪事件 当有消息可读时会调用此方法，我们可以在这里读取消息并处理。
     *
     * @param ctx
     * @param textWebSocketFrame
     * @throws Exception
     */
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, TextWebSocketFrame textWebSocketFrame) throws Exception {
        //接收心跳
        Channel channel = ctx.channel();
        Attribute<String> attribute = channel.attr(AttributeKey.valueOf(channel.id().toString()));
        String userId = attribute.get();
        if (StringTools.isEmpty(userId)) {
            ctx.close();
            return;
        }
        redisComponet.saveUserHeartBeat(userId);
    }

    @Override
    public void channelWritabilityChanged(ChannelHandlerContext ctx) throws Exception {
        if (!ctx.channel().isWritable()) {
            logger.warn("Closing slow WebSocket consumer channel={}", ctx.channel().id());
            ctx.writeAndFlush(new CloseWebSocketFrame(1013, "Try again later"))
                    .addListener(future -> ctx.close());
            return;
        }
        ctx.fireChannelWritabilityChanged();
    }


    //用于处理用户自定义的事件  当有用户事件触发时会调用此方法，例如连接超时，异常等。
    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
        if (evt instanceof WebSocketServerProtocolHandler.HandshakeComplete) {
            TokenUserInfoDto tokenUserInfoDto = ctx.channel().attr(WsAuthenticationHandler.AUTH_CONTEXT).get();
            if (null == tokenUserInfoDto) {
                ctx.channel().close();
                return;
            }
            /**
             * 用户加入
             */
            channelContextUtils.addContext(tokenUserInfoDto.getUserId(), ctx.channel());

        }
    }
}
