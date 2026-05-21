<template>
    <div class="send-panel">
        <div class="toolbar">
            <el-popover
                :visible="showEmojiPopover"
                trigger="click"
                placement="top"
                :teleported="false"
                @show="openPopover"
                @hide="closePopover"
                :popper-style="{ padding: '0px 10px 10px 10px', width: '490px' }"
            >
                <template #default>
                    <el-tabs v-model="activeEmoji" @click.stop>
                        <el-tab-pane v-for="emoji in emojiList" :label="emoji.name" :name="emoji.name">
                            <div class="emoji-list">
                                <div class="emoji-item" v-for="item in emoji.emojiList" @click="sendEmoji(item)">
                                    {{ item }}
                                </div>
                            </div>
                        </el-tab-pane>
                    </el-tabs>
                </template>
                <template #reference>
                    <div class="iconfont icon-emoji" @click="showEmojiPopoverHandler"></div>
                </template>
            </el-popover>
            <el-upload
                ref="uploadRef"
                name="file"
                :show-file-list="false"
                :multiple="true"
                :limit="fileLimit"
                :http-request="uploadFile"
                :on-exceed="uploadExceed"
            >
                <div class="iconfont icon-folder"></div>
            </el-upload>
        </div>
        <div class="input-area" @drop="dropHandler" @dragover="dragoverHandler">
            <el-input
                row="5"
                v-model="msgContent"
                type="textarea"
                resize="none"
                maxlength="500"
                show-word-limit
                spellcheck="false"
                input-style="background:#f5f5f5:border:none"
                @paste="pasteHandler"
                @keydown.enter="sendMessage"
            />
        </div>
        <div class="send-btn-panel">
            <el-popover
                :visible="showSendMessagePopover"
                trigger="click"
                :hide-after="1500"
                placement="top-end"
                :teleported="false"
                @show="openPopover"
                @hide="closePopover"
                :popper-style="{ padding: '5px', 'min-width': '0px', width: '120px' }"
            >
                <template #default>
                    <span class="empty-msg">不能发送空消息</span>
                </template>
                <template #reference>
                    <span class="send-btn" @click="sendMessage">发送(S)</span>
                </template>
            </el-popover>
        </div>
    </div>
</template>

<script setup>
import emojiList from '../../utils/Emoji';
import { ref, reactive, getCurrentInstance, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router';
const route = useRoute();
const router = useRouter();
const { proxy } = getCurrentInstance();
const activeEmoji = ref('笑脸')
const msgContent = ref()

const sendMessage = () => {

}
</script>

<style lang="scss" scoped>
</style>
