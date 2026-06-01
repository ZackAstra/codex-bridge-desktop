try {
  const electron = process.binding('electron');
  console.log('binding found:', typeof electron);
} catch (e) {
  console.log('binding error:', e.message);
}
