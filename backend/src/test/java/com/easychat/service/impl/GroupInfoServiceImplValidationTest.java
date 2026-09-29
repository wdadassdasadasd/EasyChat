package com.easychat.service.impl;

import com.easychat.entity.po.GroupInfo;
import com.easychat.entity.query.GroupInfoQuery;
import com.easychat.exception.BusinessException;
import com.easychat.mappers.GroupInfoMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GroupInfoServiceImplValidationTest {

    private GroupInfoServiceImpl service;
    private GroupInfoMapper<GroupInfo, GroupInfoQuery> groupInfoMapper;

    @BeforeEach
    void setUp() {
        service = new GroupInfoServiceImpl();
        groupInfoMapper = mock(GroupInfoMapper.class);
        ReflectionTestUtils.setField(service, "groupInfoMapper", groupInfoMapper);
    }

    @Test
    void rejectsAvatarWithoutCoverBeforeChangingGroupState() {
        GroupInfo group = new GroupInfo();
        group.setGroupId("G1001");
        group.setGroupOwnerId("U1001");
        MockMultipartFile avatar = new MockMultipartFile("avatarFile", "avatar.png", "image/png", new byte[]{1});

        assertThrows(BusinessException.class, () -> service.saveGroup(group, avatar, null));
    }

    @Test
    void rejectsUnknownGroupForUpdateAndDissolution() {
        GroupInfo group = new GroupInfo();
        group.setGroupId("G404");
        group.setGroupOwnerId("U1001");
        when(groupInfoMapper.selectByGroupId("G404")).thenReturn(null);

        assertThrows(BusinessException.class, () -> service.saveGroup(group, null, null));
        assertThrows(BusinessException.class, () -> service.dissolutionGroup("U1001", "G404"));
        assertThrows(BusinessException.class, () -> service.dissolutionGroup("U1001", null));
    }
}
