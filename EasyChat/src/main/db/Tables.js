const add_tables = [
  // 聊天链路核心表：chat_message 存消息明细，chat_session_user 存会话摘要，chat_session_clear 存清空游标。
  'create table if not exists chat_message(' +
    '  user_id varchar not null,' +
    '  message_id bigint not null,' +
    '  session_id varchar,' +
    '  message_type integer,' +
    '  message_content varchar,' +
    '  contact_type integer,' +
    '  send_user_id varchar,' +
    '  send_user_nick_name varchar,' +
    '  send_time bigint,' +
    '  status integer,' +
    '  file_size bigint,' +
    '  file_name varchar,' +
    '  file_path varchar,' +
    '  file_type integer,' +
    '  primary key(user_id, message_id)' +
    ');',
  'create table if not exists chat_session_user(' +
    'user_id varchar not null default 0,' +
    'contact_id varchar(64) not null,' +
    'contact_type integer(1),' +
    'session_id varchar(64),' +
    'status integer default 1,' +
    'contact_name varchar(128),' +
    'last_message varchar(500),' +
    'last_receive_time bigint,' +
    'no_read_count integer default 0,' +
    'member_count integer,' +
    'top_type integer default 0,' +
    'primary key (user_id, contact_id)' +
    ');',
  'create table if not exists user_setting (' +
    'user_id varchar not null,' +
    'email varchar not null,' +
    'sys_setting varchar,' +
    'contact_no_read integer,' +
    'server_port integer,' +
    'primary key (user_id)' +
    ');',
  'create table if not exists chat_session_clear (' +
    'user_id varchar not null,' +
    'session_id varchar not null,' +
    'clear_message_id bigint default 0,' +
    'clear_time bigint default 0,' +
    'primary key (user_id, session_id)' +
    ');'
]

const optional_tables = [
  [
    'create virtual table if not exists chat_message_fts using fts5(',
    'user_id unindexed,',
    'session_id unindexed,',
    'message_id unindexed,',
    'message_content,',
    'file_name',
    ');'
  ].join(' ')
]

// alter_tables 定义数据库迁移（每次新增列/索引后在此追加条目）：
// 每个条目包含 { tableName, field, sql } — 如果表缺少 field 列，则自动执行 sql（幂等）。
// 示例：
// {
//   tableName: 'chat_message',
//   field: 'extra_info',
//   sql: 'alter table chat_message add column extra_info varchar'
// },
const alter_tables = []

const add_index = [
  'create index if not exists idx_session_id' + ' on chat_message(' + ' session_id asc' + ');',
  'create index if not exists idx_chat_message_user_session_message' +
    ' on chat_message(' +
    ' user_id asc,' +
    ' session_id asc,' +
    ' message_id desc' +
    ');',
  'create index if not exists idx_chat_session_user_sort' +
    ' on chat_session_user(' +
    ' user_id asc,' +
    ' status asc,' +
    ' top_type desc,' +
    ' last_receive_time desc' +
    ');'
]

export { add_tables, optional_tables, add_index, alter_tables }
