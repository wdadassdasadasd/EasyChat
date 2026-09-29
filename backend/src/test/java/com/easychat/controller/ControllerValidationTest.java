package com.easychat.controller;

import org.junit.jupiter.api.Test;
import org.springframework.validation.annotation.Validated;

import static org.junit.jupiter.api.Assertions.assertNotNull;

class ControllerValidationTest {

    @Test
    void enablesMethodValidationOnControllersThatDeclareParameterConstraints() {
        Class<?>[] controllers = {
                AdminGroupController.class,
                AdminUserInfoController.class,
                ChatController.class,
                GroupController.class,
                UserContactController.class,
                UserInfoController.class
        };

        for (Class<?> controller : controllers) {
            assertNotNull(controller.getAnnotation(Validated.class), controller.getSimpleName());
        }
    }
}
