type Params = Record<string, string | number>

/** The API's error codes in Chinese; a function takes the error's params and field. */
const messages: Record<string, string | ((p: Params, field?: string) => string)> = {
  internal: '服务器内部错误，请稍后重试',
  malformed_request: '请求参数无效',
  invalid_request: (_, field) => (field ? `请求参数「${field}」无效` : '请求参数无效'),
  not_found: '请求的地址不存在',
  method_not_allowed: '不支持的请求方法',

  unauthenticated: '请先登录',
  forbidden: '没有访问权限',
  token_read_only: '该 API 令牌为只读权限',
  token_not_admin: '该 API 令牌没有管理权限',
  session_required: 'API 令牌不能用于此操作，请登录网页后操作',
  invalid_token: 'API 令牌无效、已过期或已被撤销',
  session_expired: '登录已过期，请重新登录',
  cross_site_request: '不能从其他网站发起此操作',
  invalid_credentials: '邮箱或密码错误',
  account_disabled: '该账号已被禁用，请联系管理员',
  wrong_password: '当前密码不正确',
  admin_scope_forbidden: '只有管理员可以创建管理权限的令牌',
  token_not_found: '令牌不存在',
  session_not_found: '该设备已退出登录',
  user_not_found: '用户不存在',
  username_taken: '该用户名已被使用',
  email_taken: '该邮箱已注册',
  account_taken: '用户名或邮箱已被使用',
  own_account: '不能修改或删除自己的账号',
  last_admin: '不能移除最后一个管理员',

  empty_search: '请输入关键词或添加图片',
  search_image_too_large: (p) => `图片不能超过 ${p.max_mb} MB`,
  search_not_image: '仅支持按图片搜索',
  search_expired: '搜索已过期，请重新搜索',
  library_search_unauthenticated: '登录后才能搜索我的库',
  invalid_cursor: '游标无效',

  meme_not_found: '表情包不存在或未公开',
  collection_not_found: '合集不存在或未公开',
  folder_not_found: '文件夹不存在',
  target_folder_not_found: '目标文件夹不存在',
  items_not_found: '部分项目不存在或已被删除',
  file_not_found: '文件不存在',
  invalid_asset_token: '无效的访问令牌',
  invalid_name: (p) => `名称需为 1–${p.max} 个字符`,
  invalid_path: '路径中的文件夹名称需为 1–255 个字符',
  name_taken: '同一位置已存在同名项目',
  path_blocked_by_file: '同一位置已存在同名文件',
  folder_already_owned: '文件夹已在我的库中',
  folder_into_itself: '不能把文件夹移动或复制到它自身或子文件夹中',
  file_too_large: (p) => `文件超过 ${p.max_mb} MB 的大小限制`,
  unsupported_file_type: (p) => `不支持的文件类型：${p.type}`,
  vlm_json_admin_only: '仅管理员可上传识别结果',
  invalid_vlm_json: '识别结果需为 JSON 对象',
  share_not_in_library: '只能为我的库中的表情包创建私密链接',
  retry_not_in_library: '只能重试自己库中的表情包',

  invalid_tag: '标签需为 1–50 个字符',
  tag_name_taken: '已存在同名标签，请改用合并',
  merge_into_source: '目标标签不能是被合并的标签',
  user_tag_not_mergeable: (p) => `「${p.tag}」是用户添加的标签，不参与合并`,

  task_not_found: '任务不存在',
  batch_not_found: '批次不存在',
  task_run_not_queued: '只有排队中的任务可以立即执行',
  task_cancel_not_queued: '只有排队中的任务可以取消',
  batch_none_queued: '批次中没有排队中的任务',
  no_tasks_given: '请指定要重试的任务',
  no_memes_given: '请指定要重新处理的表情包',
  invalid_attr_filter: '信息条件需为 key=value 形式',
  inference_unavailable: '推理服务无响应',
}

/** Words an API error by its code; undefined for a code without wording, whose English message then shows. */
export function errorMessage(body: { code?: string; params?: Params; field?: string } | null): string | undefined {
  const m = body?.code ? messages[body.code] : undefined
  return typeof m === 'function' ? m(body?.params ?? {}, body?.field) : m
}
