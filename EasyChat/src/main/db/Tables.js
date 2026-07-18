const add_tables = [
  'create table if not exists schema_migrations(' +
    'version integer primary key,' +
    'name varchar not null,' +
    'applied_at bigint not null' +
    ');',
  // 聊天链路核心表：chat_message 存消息明细，chat_session_user 存会话摘要，chat_session_clear 存清空游标。
  'create table if not exists chat_message(' +
    '  user_id varchar not null,' +
    '  message_id bigint not null,' +
    '  client_message_id varchar,' +
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
  'create table if not exists sync_cursor(' +
    '  user_id varchar primary key,' +
    '  server_sequence bigint not null default 0,' +
    '  updated_at bigint not null' +
    ');',
  'create table if not exists processed_event(' +
    '  user_id varchar not null,' +
    '  event_id varchar not null,' +
    '  server_sequence bigint not null,' +
    '  processed_at bigint not null,' +
    '  primary key (user_id, event_id)' +
    ');',
  'create table if not exists read_receipt_outbox(' +
    '  user_id varchar not null,' +
    '  contact_id varchar not null,' +
    '  request_id varchar not null,' +
    '  created_at bigint not null,' +
    '  updated_at bigint not null,' +
    '  primary key (user_id, contact_id)' +
    ');',
  'create table if not exists snapshot_progress(' +
    '  user_id varchar primary key,' +
    '  snapshot_id varchar not null,' +
    '  snapshot_cursor bigint not null,' +
    '  next_session_cursor varchar,' +
    '  updated_at bigint not null' +
    ');',
  'create table if not exists snapshot_stage_session(' +
    '  user_id varchar not null,' +
    '  snapshot_id varchar not null,' +
    '  contact_id varchar not null,' +
    '  payload varchar not null,' +
    '  primary key (user_id, snapshot_id, contact_id)' +
    ');',
  'create table if not exists snapshot_stage_message(' +
    '  user_id varchar not null,' +
    '  snapshot_id varchar not null,' +
    '  message_id bigint not null,' +
    '  payload varchar not null,' +
    '  primary key (user_id, snapshot_id, message_id)' +
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
    ');',
  // 主进程托管的上传任务独立于 chat_message：消息负责业务展示，任务负责可恢复传输状态。
  'create table if not exists upload_task(' +
    'user_id varchar not null,' +
    'task_id varchar not null,' +
    'message_id bigint not null,' +
    'upload_source_id varchar not null,' +
    'state varchar not null,' +
    'upload_id varchar,' +
    'file_name varchar not null,' +
    'file_size bigint not null,' +
    'file_type integer,' +
    'total_chunks integer,' +
    'uploaded_bytes bigint default 0,' +
    'last_error varchar,' +
    'created_at bigint not null,' +
    'updated_at bigint not null,' +
    'primary key (user_id, task_id),' +
    'unique (user_id, message_id)' +
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
const upload_recovery_columns = [
  {
    tableName: 'chat_message',
    field: 'client_message_id',
    sql: 'alter table chat_message add column client_message_id varchar'
  },
  {
    tableName: 'chat_message',
    field: 'upload_source_id',
    sql: 'alter table chat_message add column upload_source_id varchar'
  },
  {
    tableName: 'upload_task',
    field: 'cover_source_id',
    sql: 'alter table upload_task add column cover_source_id varchar'
  }
]

const add_index = [
  'create index if not exists idx_session_id' + ' on chat_message(' + ' session_id asc' + ');',
  'create index if not exists idx_chat_message_user_session_message' +
    ' on chat_message(' +
    ' user_id asc,' +
    ' session_id asc,' +
    ' message_id desc' +
    ');',
  'create unique index if not exists idx_chat_message_user_client_message on chat_message(user_id asc, client_message_id asc) where client_message_id is not null;',
  'create index if not exists idx_processed_event_user_sequence on processed_event(user_id asc, server_sequence asc);',
  'create index if not exists idx_snapshot_stage_session_user_snapshot on snapshot_stage_session(user_id asc, snapshot_id asc);',
  'create index if not exists idx_chat_session_user_sort' +
    ' on chat_session_user(' +
    ' user_id asc,' +
    ' status asc,' +
    ' top_type desc,' +
    ' last_receive_time desc' +
    ');',
  'create index if not exists idx_upload_task_user_state on upload_task(user_id asc, state asc, updated_at asc);'
]

export { add_tables, optional_tables, add_index, upload_recovery_columns }
