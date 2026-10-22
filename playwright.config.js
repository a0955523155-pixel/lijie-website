import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser',workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:4178',launchOptions:process.platform==='win32'?{channel:'chrome'}:{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}},
  webServer:{command:'node tests/static-server.mjs',url:'http://127.0.0.1:4178',reuseExistingServer:false},
  reporter:[['list'],['html',{open:'never'}]]
});
