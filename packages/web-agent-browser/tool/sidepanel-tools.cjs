/** Every tool name the side panel can ever be offered, including gated ones.
 *  A tool the side panel never runs is NOT listed, and a brand agent YAML that
 *  names one fails the build (show_generative_ui — see
 *  src/lib/sidepanel-tool-filter.ts). */
const SIDE_PANEL_TOOL_NAMES = [
  // core defaultTools
  "wait",
  "get_time",
  "list_data_sources",
  "get_field_details",
  "sample_field_values",
  "query_data",
  "search_skills",
  "load_skill",
  "create_skill",
  "delete_skill",
  "compact_conversation",
  "set_schedule",
  "list_schedules",
  "cancel_schedule",
  "todo_write",
  "todo_read",
  // tab tools
  "read_tabs",
  "open_tab",
  "navigate_tab",
  "refresh_tab",
  "close_tab",
  // page agent tools
  "send_to_page_agent",
  "toggle_page_agent",
  "read_page_agent",
  // panel page tools
  "page_eval",
  "page_fetch",
  "page_console",
  "page_snapshot",
  "page_click",
  "page_fill_form",
  "page_select_option",
  "page_verify",
  "page_generate_locator",
  "page_network",
  "page_dialog",
  "page_upload_file",
  "start_debugging",
  "stop_debugging",
  "page_hover",
  "page_press_key",
  "page_emulate",
  "start_recording",
  "stop_recording",
  "page_screenshot",
  // vfs tools
  "read_file",
  "write_file",
  "edit_file",
  "glob_files",
  "search_files",
  "delete_file",
  "move_file",
  "json_get",
  "json_edit",
  "bundle_html",
];

/** The 18 side panel tools that require an active debugger session (start_debugging). */
const DEBUGGER_GATED_TOOLS = [
  "page_snapshot",
  "page_click",
  "page_fill_form",
  "page_select_option",
  "page_hover",
  "page_press_key",
  "page_emulate",
  "page_network",
  "page_dialog",
  "page_upload_file",
  "page_eval",
  "page_fetch",
  "page_console",
  "page_verify",
  "page_generate_locator",
  "page_screenshot",
  "start_recording",
  "stop_recording",
];

module.exports = { SIDE_PANEL_TOOL_NAMES, DEBUGGER_GATED_TOOLS };
