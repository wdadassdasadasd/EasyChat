package com.easychat.websocket.netty;

import com.easychat.entity.dto.TokenUserInfoDto;
import com.easychat.redis.RedisComponet;
import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.util.AttributeKey;
import org.springframework.stereotype.Component;

/** Authenticates a WebSocket upgrade before the protocol handler accepts it. */
@ChannelHandler.Sharable
@Component
public class WsAuthenticationHandler extends SimpleChannelInboundHandler<FullHttpRequest> {
    public static final AttributeKey<TokenUserInfoDto> AUTH_CONTEXT = AttributeKey.valueOf("easychat.ws.auth");

    @javax.annotation.Resource
    private RedisComponet redisComponet;

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, FullHttpRequest request) {
        if (!request.uri().startsWith("/ws")) {
            ctx.close();
            return;
        }
        String authorization = request.headers().get("Authorization");
        String token = authorization != null && authorization.startsWith("Bearer ") ? authorization.substring(7).trim() : null;
        TokenUserInfoDto userInfo = redisComponet.getTokenUserInfoDto(token);
        if (userInfo == null) {
            ctx.close();
            return;
        }
        ctx.channel().attr(AUTH_CONTEXT).set(userInfo);
        ctx.fireChannelRead(request.retain());
    }
}
