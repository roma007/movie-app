const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TARBALLS = [
  'TensorFlowLiteC-2.14.0.tar.gz',
];

/**
 * 离线注入 TFLiteC 的 vendored xcframework。
 * 该 pod 从 dl.google.com 下载（被墙），CocoaPods 1.15+ 在 install 时因框架文件缺失
 * 而跳过了 vendored xcframework 的搜索路径注册，导致编译期找不到 TensorFlowLiteC 头文件。
 * 因此本插件在 prebuild 时：
 *  1) 把 tar 包拷入 ios/local_vendored/（prebuild 会清空 ios/，故源放在 plugins/ 下保留）
 *  2) 在 Podfile 的 post_install 钩子里把 xcframework 解包到 Pods 对应目录
 *  3) 并补丁 Target Support Files 的 xcconfig，把框架所在目录加回 FRAMEWORK_SEARCH_PATHS
 */
function withLocalVendored(config) {
  return withDangerousMod(config, [
    'ios',
    (configMod) => {
      const iosRoot = configMod.modRequest.platformProjectRoot;
      const srcDir = path.join(__dirname, 'local_vendored');
      const dstDir = path.join(iosRoot, 'local_vendored');

      if (!fs.existsSync(dstDir)) {
        fs.mkdirSync(dstDir, { recursive: true });
      }
      for (const f of TARBALLS) {
        const s = path.join(srcDir, f);
        if (fs.existsSync(s)) {
          fs.copyFileSync(s, path.join(dstDir, f));
        }
      }

      const podfilePath = path.join(iosRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (contents.includes('local_vendored')) {
        return configMod;
      }

      const snippet = `
    # === Offline vendored frameworks (TFLiteC) ===
    require 'fileutils'
    local_dir = File.join(__dir__, 'local_vendored')
    tf_pod = File.join(__dir__, 'Pods/TensorFlowLiteC')
    tf_fw = File.join(tf_pod, 'Frameworks/TensorFlowLiteC.xcframework')
    unless File.exist?(tf_fw)
      tf_tgz = File.join(local_dir, 'TensorFlowLiteC-2.14.0.tar.gz')
      system("tar -xzf '\#{tf_tgz}' -C '\#{tf_pod}'") if File.exist?(tf_tgz)
    end

    # CocoaPods 1.15+ 在 install 时因框架文件缺失而跳过了 vendored xcframework 的搜索路径
    # 注册；且 <Framework/Header> 的模块解析需要把“包含 .framework 的 slice 目录”而非
    # .xcframework 容器目录加入 FRAMEWORK_SEARCH_PATHS。这里扫描 Pods 下所有 vendored
    # xcframework，把其每个 slice 目录补到“搜索路径中引用了该框架名”的各 pod target 的
    # FRAMEWORK_SEARCH_PATHS。
    cands = [
      ['TensorFlowLiteC', File.join(__dir__, 'Pods/TensorFlowLiteC/Frameworks/TensorFlowLiteC.xcframework')],
    ]
    xcframework_slices = {}
    cands.each do |fw_name, xc|
      next unless File.exist?(xc)
      slices = Dir.glob(File.join(xc, '*')).select { |d| File.directory?(d) && File.exist?(File.join(d, "\#{fw_name}.framework")) }
      next if slices.empty?
      xcframework_slices[fw_name] = slices
    end
    (installer.pod_targets + installer.aggregate_targets).each do |t|
      ['debug', 'release'].each do |cfg|
        xc = File.join(__dir__, 'Pods/Target Support Files', t.name, "\#{t.name}.\#{cfg}.xcconfig")
        next unless File.exist?(xc)
        txt = File.read(xc)
        changed = false
        xcframework_slices.each do |fw_name, slices|
          slices.each do |d|
            rel = d.gsub(__dir__ + '/Pods/', '\${PODS_ROOT}/')
            entry = "\\"#{rel}\\""
            next if txt.include?(entry)
            if txt =~ /^FRAMEWORK_SEARCH_PATHS = (.*)$/
              txt.gsub!(/^FRAMEWORK_SEARCH_PATHS = (.*)$/, "FRAMEWORK_SEARCH_PATHS = \#{$1} \#{entry}")
            else
              txt += "\\nFRAMEWORK_SEARCH_PATHS = \$(inherited) \#{entry}\\n"
            end
            changed = true
          end
          flag = "-framework \#{fw_name}"
          next if txt.include?(flag)
          if txt =~ /^OTHER_LDFLAGS = (.*)$/
            txt.gsub!(/^OTHER_LDFLAGS = (.*)$/, "OTHER_LDFLAGS = \#{$1} \#{flag}")
          else
            txt += "\\nOTHER_LDFLAGS = \$(inherited) \#{flag}\\n"
          end
          changed = true
        end
        File.write(xc, txt) if changed
      end
    end
`;

      let idx = contents.lastIndexOf('\n  end\nend\n');
      if (idx === -1) {
        idx = contents.lastIndexOf('\n  end\nend');
      }
      if (idx === -1) {
        console.warn('[withLocalVendored] 未在 Podfile 找到 post_install 结束标记，跳过注入');
        return configMod;
      }
      contents = contents.slice(0, idx) + snippet + contents.slice(idx);
      fs.writeFileSync(podfilePath, contents);
      return configMod;
    },
  ]);
}

module.exports = withLocalVendored;
