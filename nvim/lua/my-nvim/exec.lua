local M = {}

-- Which Herdr the daemon serves. The Herdr desktop app's wrapper and daemon
-- set MY_NVIM_HOST=app; the TUI plugin sets nothing.
function M.is_app()
  return vim.env.MY_NVIM_HOST == "app"
end

-- The my-nvim binary, through the app wrapper when there is one.
function M.self()
  return vim.env.MY_NVIM_SELF or "my-nvim"
end

function M.default_exec(argv)
  local r = vim.system(argv, { text = true }):wait()
  return { code = r.code, stdout = r.stdout or "", stderr = r.stderr or "" }
end

return M
