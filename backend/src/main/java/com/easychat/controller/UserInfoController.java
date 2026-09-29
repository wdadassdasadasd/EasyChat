package com.easychat.controller;

import com.easychat.annotation.GlobalInterceptor;
import com.easychat.entity.config.AppConfig;
import com.easychat.entity.constants.Constants;
import com.easychat.entity.dto.TokenUserInfoDto;
import com.easychat.entity.enums.JoinTypeEnum;
import com.easychat.entity.enums.ResponseCodeEnum;
import com.easychat.entity.po.UserInfo;
import com.easychat.entity.vo.ResponseVO;
import com.easychat.entity.vo.UserInfoVO;
import com.easychat.exception.BusinessException;
import com.easychat.service.UserInfoService;
import com.easychat.utils.CopyTools;
import com.easychat.utils.PasswordHasher;
import com.easychat.websocket.ChannelContextUtils;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Pattern;
import java.io.IOException;

/**
 * 账号信息 Controller
 */
@RestController("userInfoController")
@RequestMapping("/userInfo")
@Validated
public class UserInfoController extends ABaseController {

    @Resource
    private UserInfoService userInfoService;

    @Resource
    private ChannelContextUtils channelContextUtils;

    @Resource
    private AppConfig appConfig;

    @RequestMapping("/getUserInfo")
    @GlobalInterceptor
    public ResponseVO getUserInfo(HttpServletRequest request) {
        TokenUserInfoDto tokenUserInfoDto = getTokenUserInfo(request);
        UserInfo userInfo = userInfoService.getUserInfoByUserId(tokenUserInfoDto.getUserId());
        UserInfoVO userInfoVO = CopyTools.copy(userInfo, UserInfoVO.class);
        boolean admin = appConfig.isAdminUserId(tokenUserInfoDto.getUserId());
        userInfoVO.setAdmin(admin);
        tokenUserInfoDto.setAdmin(admin);
        return getSuccessResponseVO(userInfoVO);
    }

    @RequestMapping("/saveUserInfo")
    @GlobalInterceptor
    public ResponseVO saveUserInfo(HttpServletRequest request, UserInfo userInfo, MultipartFile avatarFile, MultipartFile avatarCover) throws IOException {
        TokenUserInfoDto tokenUserInfoDto = getTokenUserInfo(request);
        if (userInfo == null || userInfo.getNickName() == null
                || userInfo.getNickName().trim().isEmpty() || userInfo.getNickName().length() > 20
                || (userInfo.getJoinType() != null && JoinTypeEnum.getByType(userInfo.getJoinType()) == null)
                || (userInfo.getSex() != null && userInfo.getSex() != 0 && userInfo.getSex() != 1)) {
            throw new BusinessException(ResponseCodeEnum.CODE_600);
        }
        if (avatarFile != null && (avatarCover == null || avatarCover.isEmpty())) {
            throw new BusinessException("头像缩略图不能为空");
        }
        UserInfo profileUpdate = new UserInfo();
        profileUpdate.setUserId(tokenUserInfoDto.getUserId());
        profileUpdate.setNickName(userInfo.getNickName());
        profileUpdate.setJoinType(userInfo.getJoinType());
        profileUpdate.setSex(userInfo.getSex());
        profileUpdate.setPersonalSignature(userInfo.getPersonalSignature());
        profileUpdate.setAreaName(userInfo.getAreaName());
        profileUpdate.setAreaCode(userInfo.getAreaCode());
        this.userInfoService.updateUserInfo(profileUpdate, avatarFile, avatarCover);
        if (!java.util.Objects.equals(tokenUserInfoDto.getNickName(), profileUpdate.getNickName())) {
            tokenUserInfoDto.setNickName(profileUpdate.getNickName());
            resetTokenUserInfo(request, tokenUserInfoDto);
        }
        return getUserInfo(request);
    }

    @RequestMapping("/updatePassword")
    @GlobalInterceptor
    public ResponseVO updatePassword(HttpServletRequest request, @NotEmpty @Pattern(regexp = Constants.REGEX_PASSWORD) String password, Integer credentialVersion) {
        if (credentialVersion == null || credentialVersion != 2) {
            throw new com.easychat.exception.BusinessException("CLIENT_UPGRADE_REQUIRED");
        }
        TokenUserInfoDto tokenUserInfoDto = getTokenUserInfo(request);
        UserInfo userInfo = new UserInfo();
        userInfo.setPassword(PasswordHasher.hash(password));
        this.userInfoService.updateUserInfoByUserId(userInfo, tokenUserInfoDto.getUserId());
        channelContextUtils.closeContext(tokenUserInfoDto.getUserId());
        return getSuccessResponseVO(null);
    }

    @RequestMapping("/logout")
    @GlobalInterceptor
    public ResponseVO logout(HttpServletRequest request) {
        TokenUserInfoDto tokenUserInfoDto = getTokenUserInfo(request);
        //关闭ws
        channelContextUtils.closeContext(tokenUserInfoDto.getUserId());
        return getSuccessResponseVO(null);
    }
}
