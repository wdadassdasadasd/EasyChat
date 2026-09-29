package com.easychat.controller;

import com.easychat.entity.enums.ResponseCodeEnum;
import com.easychat.exception.BusinessException;
import com.easychat.service.GroupInfoService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AdminGroupControllerTest {

    @Test
    void reportsMissingGroupsAsBadRequestsInsteadOfSuccessfulResponses() {
        AdminGroupController controller = new AdminGroupController();
        GroupInfoService service = mock(GroupInfoService.class);
        when(service.getGroupInfoByGroupId("G404")).thenReturn(null);
        ReflectionTestUtils.setField(controller, "groupInfoService", service);

        BusinessException error = assertThrows(BusinessException.class,
                () -> controller.dissolutionGroup("G404"));

        assertEquals(ResponseCodeEnum.CODE_600.getCode(), error.getCode());
    }
}
