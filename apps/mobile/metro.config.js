const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// monorepo: 让 Metro 监听整个仓库（包括 packages/core）
config.watchFolders = [monorepoRoot];

// 让 Metro 能解析根 node_modules（pnpm hoisted 后共享依赖）
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// pnpm 符号链接支持
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

// 单例锁定，避免 "Invalid hook call"
const singletons = ['react', 'react-native', 'expo', 'expo-modules-core', 'expo-constants'];
config.resolver.extraNodeModules = singletons.reduce((acc, name) => {
  acc[name] = path.resolve(projectRoot, 'node_modules', name);
  return acc;
}, {});

module.exports = config;
