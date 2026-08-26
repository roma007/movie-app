const { withXcodeProject, withGradleProperties, IOSConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODEL_NAME = 'model-cn';

/**
 * 把离线语音模型（assets/model-cn）固化进原生构建：
 * - iOS: 拷贝到 ios/MovieApp/model-cn，并作为资源加入 Xcode 工程（打包进 .app）
 * - Android: 写入 gradle 属性 Vosk_models，供原生库拷贝进 assets
 * 取代 react-native-vosk 插件自带的模型处理（其 iOS 资源引用在本项目未生效）。
 */
function withVoskModel(config) {
  config = withXcodeProject(config, (configMod) => {
    const project = configMod.modResults;
    const iosRoot = configMod.modRequest.platformProjectRoot;
    const projectRoot = configMod.modRequest.projectRoot;
    const src = path.join(projectRoot, 'assets', MODEL_NAME);
    const dst = path.join(iosRoot, 'MovieApp', MODEL_NAME);

    if (!fs.existsSync(src)) {
      console.warn(`[withVoskModel] 未找到模型目录: ${src}`);
      return configMod;
    }

    fs.cpSync(src, dst, { recursive: true });

    IOSConfig.XcodeUtils.ensureGroupRecursively(project, 'Resources');
    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: `MovieApp/${MODEL_NAME}`,
      groupName: 'Resources',
      project,
      isBuildFile: true,
      verbose: false,
    });

    return configMod;
  });

  config = withGradleProperties(config, (configMod) => {
    const key = 'Vosk_models';
    const value = `assets/${MODEL_NAME}`;
    const idx = configMod.modResults.findIndex(
      (p) => p.type === 'property' && p.key === key
    );
    if (idx >= 0) {
      configMod.modResults[idx].value = value;
    } else {
      configMod.modResults.push({ type: 'property', key, value });
    }
    return configMod;
  });

  return config;
}

module.exports = withVoskModel;
