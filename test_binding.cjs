try {
  const app = process._linkedBinding('electron_browser_app');
  console.log('app binding found:', typeof app);
} catch (e) {
  console.log('app binding error:', e.message);
}

try {
  const common = process._linkedBinding('electron_common_v8_util');
  console.log('common binding found:', typeof common);
} catch (e) {
  console.log('common binding error:', e.message);
}
