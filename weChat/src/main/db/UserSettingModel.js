import store from '../store';
import {
    insertOrIgnore,
    queryOne,
    run,
    update
} from './ADB';

const os = require("os");
const fs = require("fs");
const path = require("path");
const userDir = os.homedir();

const defaultLocalFileFolder = () => {
    return path.join(userDir, ".weChat", "fileStorge");
};

const ensureFolder = (folder) => {
    if (folder && !fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
};

const parseSysSetting = (sysSetting) => {
    try {
        return sysSetting ? JSON.parse(sysSetting) : {};
    } catch (e) {
        return {};
    }
};

const getFolderStats = (folder) => {
    const stats = {
        exists: false,
        fileCount: 0,
        totalSize: 0
    };

    if (!folder || !fs.existsSync(folder)) {
        return stats;
    }

    stats.exists = true;
    const walk = (dir) => {
        let fileList = [];
        try {
            fileList = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }
        fileList.forEach((item) => {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
                walk(fullPath);
            } else if (item.isFile()) {
                try {
                    const fileStat = fs.statSync(fullPath);
                    stats.fileCount++;
                    stats.totalSize += fileStat.size;
                } catch (e) {
                    // Ignore files that disappear while the folder is being scanned.
                }
            }
        });
    };

    walk(folder);
    return stats;
};

const updateNoReadCount = async (contactId, noReadCount) => {
        let sql = null;
        if (noReadCount === 0) {
            return;
        }
        if (noReadCount) {
            sql = "update user_setting set contact_no_read=contact_no_read+? where user_id=?";
        } else {
            noReadCount = 0;
            sql = "update user_setting set contact_no_read=? where user_id=?";
        }
        await run(sql, [noReadCount, contactId]);
};

const addUserSetting = async (userId, email) => {
    let sql = "select max(server_port) maxserver_port from user_setting";
    const maxServerInfo = await queryOne(sql, []);
    let serverPort = maxServerInfo?.maxserverPort;
    if (serverPort == null) {
        serverPort = 10240;
    } else {
        serverPort++;
    }

    const sysSetting = {
        localFileFolder: defaultLocalFileFolder()
    };
    sql = "select * from user_setting where user_id=?";
    const userInfo = await queryOne(sql, [userId]);
    let resultServerPort = null;
    let localFileFolder = null;

    if (userInfo) {
        await update("user_setting", { email }, { userId });
        resultServerPort = userInfo.serverPort;
        localFileFolder = parseSysSetting(userInfo.sysSetting).localFileFolder || sysSetting.localFileFolder;
    } else {
        await insertOrIgnore("user_setting", {
            userId,
            email,
            sysSetting: JSON.stringify(sysSetting),
            contactNoRead: 0,
            serverPort
        });
        resultServerPort = serverPort;
        localFileFolder = sysSetting.localFileFolder;
    }

    ensureFolder(localFileFolder);
    store.setUserData("localSeverPort", resultServerPort);
    store.setUserData("localFileFolder", localFileFolder);
};

const getLocalFileFolder = async () => {
    const userId = store.getUserId();
    const defaultFolder = defaultLocalFileFolder();
    let localFileFolder = store.getUserData("localFileFolder");

    if (!localFileFolder && userId) {
        const userInfo = await queryOne("select * from user_setting where user_id=?", [userId]);
        localFileFolder = parseSysSetting(userInfo?.sysSetting).localFileFolder;
    }

    localFileFolder = localFileFolder || defaultFolder;
    ensureFolder(localFileFolder);
    store.setUserData("localFileFolder", localFileFolder);

    return {
        localFileFolder,
        defaultFolder,
        isDefault: path.normalize(localFileFolder) === path.normalize(defaultFolder),
        ...getFolderStats(localFileFolder)
    };
};

const updateLocalFileFolder = async (folder) => {
    const userId = store.getUserId();
    if (!userId || !folder) {
        return await getLocalFileFolder();
    }

    const localFileFolder = path.normalize(folder);
    ensureFolder(localFileFolder);
    const userInfo = await queryOne("select * from user_setting where user_id=?", [userId]);
    const sysSetting = parseSysSetting(userInfo?.sysSetting);
    sysSetting.localFileFolder = localFileFolder;
    await update("user_setting", { sysSetting: JSON.stringify(sysSetting) }, { userId });
    store.setUserData("localFileFolder", localFileFolder);
    return await getLocalFileFolder();
};

const resetLocalFileFolder = async () => {
    return await updateLocalFileFolder(defaultLocalFileFolder());
};

export {
    updateNoReadCount,
    addUserSetting,
    getLocalFileFolder,
    updateLocalFileFolder,
    resetLocalFileFolder
};
