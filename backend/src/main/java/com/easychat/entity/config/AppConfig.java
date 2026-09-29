package com.easychat.entity.config;

import com.easychat.utils.StringTools;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Arrays;

@Component("appConfig")
public class AppConfig {
    /**
     * websocket 端口
     */
    @Value("${ws.port:}")
    private Integer wsPort;

    @Value("${ws.host:0.0.0.0}")
    private String wsHost;
    /**
     * 文件目录
     */
    @Value("${project.folder:}")
    private String projectFolder;

    @Value("${admin.user-ids:}")
    private String adminUserIds;

    public String getProjectFolder() {
        if (!StringTools.isEmpty(projectFolder) && !projectFolder.endsWith("/")) {
            projectFolder = projectFolder + "/";
        }
        return projectFolder;
    }

    public boolean isAdminUserId(String userId) {
        if (StringTools.isEmpty(userId) || StringTools.isEmpty(adminUserIds)) {
            return false;
        }
        String normalizedUserId = userId.trim();
        return Arrays.stream(adminUserIds.split(","))
                .map(String::trim)
                .filter(item -> !item.isEmpty())
                .anyMatch(normalizedUserId::equals);
    }

    public Integer getWsPort() {
        return wsPort;
    }

    public String getWsHost() {
        return wsHost;
    }
}
