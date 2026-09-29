package com.easychat;

import com.easychat.websocket.netty.NettyWebSocketStarter;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import javax.sql.DataSource;
import java.sql.Connection;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class InitRunTest {

    @Test
    void closesDatabaseProbeAndStartsWebSocketBeforeReportingReady() throws Exception {
        InitRun initRun = new InitRun();
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        NettyWebSocketStarter starter = mock(NettyWebSocketStarter.class);
        when(dataSource.getConnection()).thenReturn(connection);
        ReflectionTestUtils.setField(initRun, "dataSource", dataSource);
        ReflectionTestUtils.setField(initRun, "nettyWebSocketStarter", starter);

        initRun.run(null);

        verify(connection).close();
        verify(starter).start();
    }

    @Test
    void propagatesWebSocketBindFailureSoSpringStartupFails() {
        InitRun initRun = new InitRun();
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        NettyWebSocketStarter starter = mock(NettyWebSocketStarter.class);
        try {
            when(dataSource.getConnection()).thenReturn(connection);
        } catch (Exception error) {
            throw new AssertionError(error);
        }
        doThrow(new IllegalStateException("port in use")).when(starter).start();
        ReflectionTestUtils.setField(initRun, "dataSource", dataSource);
        ReflectionTestUtils.setField(initRun, "nettyWebSocketStarter", starter);

        assertThrows(IllegalStateException.class, () -> initRun.run(null));
    }
}
