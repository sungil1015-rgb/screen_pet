const { spawn } = require('child_process');
const electron = require('electron');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
const args = process.argv.slice(2);
if (!args.length) args.push('.');
const child = spawn(electron, args, { stdio: 'inherit', env: env, windowsHide: false });
child.on('exit', (code) => process.exit(code == null ? 1 : code));
