console.log('electronBinding:', typeof process.electronBinding);
console.log('_linkedBinding:', typeof process._linkedBinding);
console.log('versions.electron:', process.versions.electron);
const keys = Object.keys(process).filter(k => k.toLowerCase().includes('electron'));
console.log('electron keys:', keys);
