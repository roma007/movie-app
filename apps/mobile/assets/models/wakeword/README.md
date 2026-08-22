# 唤醒词模型文件说明

## 目录结构

```
assets/models/wakeword/
├── README.md                    # 本文件
├── melspectrogram/              # 梅尔频谱模型
│   └── melspectrogram.tflite   # 梅尔频谱提取模型
├── embedding/                   # 嵌入模型
│   └── embedding.tflite        # 唤醒词嵌入模型
└── wakeword/                    # 唤醒词模型
    └── hey_movie.tflite        # "小MM"唤醒词模型
```

## 模型获取方式

### 方式1：使用预训练模型（推荐）

openWakeWord 提供了预训练的英文唤醒词模型，但不提供中文模型。
对于中文唤醒词"小MM"，需要使用方式2进行训练。

### 方式2：本地训练自定义唤醒词

#### 1. 安装 openWakeWord 训练工具

```bash
# 创建虚拟环境
python -m venv openwakeword-env
source openwakeword-env/bin/activate  # macOS/Linux
# 或 openwakeword-env\Scripts\activate  # Windows

# 安装依赖
pip install openwakeword
pip install openwakeword[training]
```

#### 2. 准备训练数据

录制"小MM"唤醒词的音频样本：
- 至少录制 50-100 个样本
- 每个样本 1-3 秒
- 包含不同语速、音调、环境噪音
- 保存为 WAV 格式，16kHz 采样率

```bash
# 创建数据目录
mkdir -p training_data/positive
mkdir -p training_data/negative

# 将正样本（说"小MM"的音频）放入 positive 目录
# 将负样本（不说"小MM"的音频）放入 negative 目录
```

#### 3. 训练模型

```bash
# 使用 openWakeWord 训练工具
openwakeword.train \
  --positive(training_data/positive \
  --negative(training_data/negative \
  --output models/wakeword \
  --name hey_movie
```

#### 4. 转换为 TFLite 格式

训练完成后，将模型转换为 TFLite 格式：

```python
import openwakeword
from openwakeword.model import Model

# 加载训练好的模型
model = Model(wakeword_models=["models/wakeword/hey_movie.onnx"])

# 导出为 TFLite
model.export_tflite("assets/models/wakeword/hey_movie.tflite")
```

### 方式3：使用在线资源

可以从以下资源获取中文唤醒词模型：
- openWakeWord 官方模型库
- GitHub 上的中文唤醒词项目
- 自己训练的模型

## 模型文件说明

### melspectrogram.tflite
- 功能：将音频信号转换为梅尔频谱图
- 输入：原始音频波形（16kHz，单声道）
- 输出：梅尔频谱图特征

### embedding.tflite
- 功能：将梅尔频谱图转换为嵌入向量
- 输入：梅尔频谱图特征
- 输出：256维嵌入向量

### hey_movie.tflite
- 功能：检测"小MM"唤醒词
- 输入：嵌入向量
- 输出：唤醒词检测概率（0-1）

## 测试模型

```bash
# 运行测试脚本
node scripts/test-wakeword.js
```

## 注意事项

1. 模型文件需要放在正确的目录结构中
2. 模型文件大小会影响应用启动时间
3. 建议使用量化后的 TFLite 模型以减小文件体积
4. 首次使用时需要请求麦克风权限

## 相关链接

- openWakeWord 官方文档：https://github.com/dscripka/openWakeWord
- react-native-openwakeword：https://github.com/react-native-openwakeword/react-native-openwakeword
