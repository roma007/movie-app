#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const rootPkgPath = resolve(root, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
const currentVersion = rootPkg.version;

const [major, minor, patch] = currentVersion.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;

console.log(`Bumping version: ${currentVersion} → ${newVersion}`);

const entries = [
  {
    path: 'package.json',
    pattern: /"version": "\d+\.\d+\.\d+"/,
    replacement: `"version": "${newVersion}"`,
  },
  {
    path: 'apps/desktop/package.json',
    pattern: /"version": "\d+\.\d+\.\d+"/,
    replacement: `"version": "${newVersion}"`,
  },
  {
    path: 'apps/desktop/src-tauri/Cargo.toml',
    pattern: /^version = "\d+\.\d+\.\d+"/m,
    replacement: `version = "${newVersion}"`,
  },
  {
    path: 'apps/desktop/src-tauri/tauri.conf.json',
    pattern: /"version": "\d+\.\d+\.\d+"/,
    replacement: `"version": "${newVersion}"`,
  },
  {
    path: 'apps/desktop/src/pages/SettingsPage.tsx',
    pattern: /Movie App · 版本 \d+\.\d+\.\d+/,
    replacement: `Movie App · 版本 ${newVersion}`,
  },
  {
    path: 'apps/desktop/src/components/Layout.tsx',
    pattern: /appVersion, setAppVersion\] = useState\('\d+\.\d+\.\d+'\)/,
    replacement: `appVersion, setAppVersion] = useState('${newVersion}')`,
  },
  {
    path: 'apps/mobile/package.json',
    pattern: /"version": "\d+\.\d+\.\d+"/,
    replacement: `"version": "${newVersion}"`,
  },
  {
    path: 'apps/mobile/app.json',
    pattern: /"version": "\d+\.\d+\.\d+"/,
    replacement: `"version": "${newVersion}"`,
  },
  {
    path: 'apps/mobile/src/pages/SettingsScreen.tsx',
    pattern: /<Text style={styles\.menuValue}>\d+\.\d+\.\d+<\/Text>/,
    replacement: `<Text style={styles.menuValue}>${newVersion}</Text>`,
  },
  {
    path: 'packages/core/package.json',
    pattern: /"version": "\d+\.\d+\.\d+"/,
    replacement: `"version": "${newVersion}"`,
  },
];

const changedFiles = [];
for (const { path, pattern, replacement } of entries) {
  const absPath = resolve(root, path);
  if (!existsSync(absPath)) {
    console.warn(`  ⚠ 文件不存在: ${path}`);
    continue;
  }
  const content = readFileSync(absPath, 'utf-8');
  const updated = content.replace(pattern, replacement);
  if (content !== updated) {
    writeFileSync(absPath, updated);
    console.log(`  ✓ ${path}`);
    changedFiles.push(path);
  } else {
    console.warn(`  ⚠ 未匹配: ${path}`);
  }
}

if (changedFiles.length > 0) {
  execSync(`git add ${changedFiles.map(f => `"${f}"`).join(' ')}`, { cwd: root });
  console.log(`\n已暂存 ${changedFiles.length} 个文件`);
} else {
  console.log('\n无文件变更');
}
