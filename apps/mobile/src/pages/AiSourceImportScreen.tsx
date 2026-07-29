import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator, Clipboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import { Button } from '../components/ui/Button';
import { SourceImportService, AI_SOURCE_PROMPT, AI_SOURCE_IMPORT_SAMPLE } from '@movie-app/core';
import type { ParsedImportSource } from '@movie-app/core';
import { Search, CheckCircle2, XCircle, AlertTriangle, HelpCircle, ClipboardPaste, Save, PartyPopper, Frown } from 'lucide-react-native';

type Step = 'prompt' | 'paste' | 'preview';

export default function AiSourceImportScreen() {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const s = useScaledFontSize();

  const { batchImportSources, validateImportSources } = useAppStore();

  const [step, setStep] = useState<Step>('prompt');
  const [pastedText, setPastedText] = useState('');
  const [preview, setPreview] = useState<ParsedImportSource[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  const validCount = preview.filter((p) => p.status === 'valid').length;

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
    headerTitle: { fontSize: s(17), fontWeight: '600' },
    stepIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 16, paddingVertical: 10 },
    stepDotRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stepDot: { width: 10, height: 10, borderRadius: radius.sm },
    stepLine: { width: 20, height: 2, backgroundColor: '#66666640' },
    stepText: { fontSize: s(12), color: '#999' },
    content: { flex: 1 },
    contentInner: { padding: 16, gap: 12 },
    description: { fontSize: s(14), lineHeight: 20 },
    promptBox: { borderRadius: radius.md, padding: 16 },
    promptText: { fontSize: s(12), lineHeight: 18, fontFamily: 'monospace' },
    pasteActions: { flexDirection: 'row', gap: 8 },
    textarea: { borderRadius: radius.md, padding: 12, fontSize: s(12), fontFamily: 'monospace', minHeight: 300, textAlignVertical: 'top' },
    previewSummary: { fontSize: s(13), marginBottom: 8 },
    previewItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 12, marginBottom: 8 },
    previewIcon: { marginTop: 2 },
    previewInfo: { flex: 1, gap: 3 },
    previewNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    previewName: { fontSize: s(14), fontWeight: '500' },
    badge: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { fontSize: s(10) },
    previewUrl: { fontSize: s(11) },
    previewError: { fontSize: s(11), color: '#ef4444' },
    previewWarn: { fontSize: s(11), color: '#eab308' },
    resultContainer: { alignItems: 'center', paddingVertical: 40, gap: 12 },
    resultTitle: { fontSize: s(18), fontWeight: '600' },
    resultSub: { fontSize: s(14) },
    footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  }), [colors, cardOpacity, s]);

  const handleCopyPrompt = () => {
    try {
      Clipboard.setString(AI_SOURCE_PROMPT);
      Alert.alert('成功', '提示词已复制到剪贴板');
    } catch {
      Alert.alert('提示', '请手动长按复制');
    }
  };

  const handlePasteFromClipboard = () => {
    try {
      Clipboard.getString().then((text) => {
        if (text) {
          setPastedText(text);
        }
      });
    } catch {
      Alert.alert('提示', '无法读取剪贴板，请手动粘贴');
    }
  };

  const handleParse = async () => {
    if (!pastedText.trim()) {
      Alert.alert('错误', '请先粘贴 AI 返回的数据');
      return;
    }
    const parsed = SourceImportService.parseJson(pastedText.trim());
    if (parsed.errors.length > 0) {
      Alert.alert('解析失败', parsed.errors[0].message);
      return;
    }
    if (parsed.items.length === 0) {
      Alert.alert('错误', '未解析到有效数据');
      return;
    }
    const p = await validateImportSources(parsed.items);
    setPreview(p);
    setStep('preview');
  };

  const handleImport = async () => {
    const validItems = preview.filter((p) => p.status === 'valid').map((p) => p.item);
    if (validItems.length === 0) {
      Alert.alert('错误', '没有可导入的有效视频源');
      return;
    }
    setImporting(true);
    try {
      const res = await batchImportSources(validItems);
      setImportResult({ imported: res.imported, skipped: res.skipped });
      if (res.imported > 0) {
        Alert.alert('成功', `成功导入 ${res.imported} 个视频源`);
      } else {
        Alert.alert('失败', `导入失败，${res.skipped} 个被跳过`);
      }
    } catch (err: any) {
      Alert.alert('错误', `导入失败: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleFinish = () => {
    navigation.goBack();
  };

  const renderStatusIcon = (status: string) => {
    if (status === 'valid') return <CheckCircle2 size={16} color="#22c55e" />;
    if (status === 'invalid_field') return <XCircle size={16} color="#ef4444" />;
    if (status === 'code_exists' || status === 'url_exists') return <AlertTriangle size={16} color="#eab308" />;
    return <HelpCircle size={16} color={colors.mutedForeground} />;
  };

  const getStatusStyle = (status: string) => {
    if (status === 'valid') return { borderColor: '#22c55e40', backgroundColor: '#22c55e10' };
    if (status === 'code_exists' || status === 'url_exists') return { borderColor: '#eab30840', backgroundColor: '#eab30810' };
    return { borderColor: '#ef444440', backgroundColor: '#ef444410' };
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
          ← 返回
        </Button>
        <Text style={[styles.headerTitle, { color: colors.text }]}>添加视频源</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.stepIndicator}>
        <View style={styles.stepDotRow}>
          <View style={[styles.stepDot, { backgroundColor: step !== 'prompt' ? colors.mutedForeground : colors.surfaceElevated }]} />
          <Text style={[styles.stepText, step === 'prompt' && { color: colors.text, fontWeight: '600' }]}>1. 复制提示词</Text>
        </View>
        <View style={styles.stepLine} />
        <View style={styles.stepDotRow}>
          <View style={[styles.stepDot, { backgroundColor: step === 'paste' ? colors.mutedForeground : step === 'prompt' ? colors.surfaceElevated : colors.mutedForeground }]} />
          <Text style={[styles.stepText, step === 'paste' && { color: colors.text, fontWeight: '600' }]}>2. 粘贴数据</Text>
        </View>
        <View style={styles.stepLine} />
        <View style={styles.stepDotRow}>
          <View style={[styles.stepDot, { backgroundColor: step === 'preview' ? colors.mutedForeground : colors.surfaceElevated }]} />
          <Text style={[styles.stepText, step === 'preview' && { color: colors.text, fontWeight: '600' }]}>3. 预览导入</Text>
        </View>
      </View>

      {step === 'prompt' && (
        <>
          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              复制下方提示词，发给 AI 助手（如 ChatGPT、Claude 等），再将 AI 返回的结果粘贴到下一步
            </Text>

            <View style={[styles.promptBox, { backgroundColor: hexToRgba(colors.surface, cardOpacity / 100) }]}>
              <Text style={[styles.promptText, { color: colors.text }]} selectable>
                {AI_SOURCE_PROMPT}
              </Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button variant="secondary" size="md" onPress={() => navigation.goBack()}>
              取消
            </Button>
            <Button variant="primary" size="md" onPress={handleCopyPrompt}>
              复制提示词
            </Button>
            <Button variant="primary" size="md" onPress={() => setStep('paste')}>
              下一步 →
            </Button>
          </View>
        </>
      )}

      {step === 'paste' && (
        <>
          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              将 AI 返回的 JSON 数据粘贴到下方文本框中，然后点击解析
            </Text>

            <View style={styles.pasteActions}>
              <Button variant="secondary" size="sm" onPress={handlePasteFromClipboard} leftIcon={<ClipboardPaste size={16} color={colors.buttonSecondaryText} />}>
                从剪贴板粘贴
              </Button>
              <Button variant="secondary" size="sm" onPress={() => setPastedText(AI_SOURCE_IMPORT_SAMPLE)}>
                查看示例
              </Button>
            </View>

            <TextInput
              style={[styles.textarea, { backgroundColor: hexToRgba(colors.surface, cardOpacity / 100), color: colors.text }]}
              placeholder="在此粘贴 AI 返回的 JSON 数据..."
              placeholderTextColor={colors.mutedForeground}
              value={pastedText}
              onChangeText={setPastedText}
              multiline
              textAlignVertical="top"
              numberOfLines={12}
            />
          </ScrollView>

          <View style={styles.footer}>
            <Button variant="secondary" size="md" onPress={() => setStep('prompt')}>
              ← 返回
            </Button>
<Button variant="primary" size="md" onPress={handleParse} rightIcon={<Search size={16} color={colors.buttonPrimaryText} />}>
               解析并预览
            </Button>
          </View>
        </>
      )}

      {step === 'preview' && (
        <>
          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            {importResult ? (
              <View style={styles.resultContainer}>
                {importResult.imported > 0 ? <PartyPopper size={40} color="#22c55e" /> : <Frown size={40} color="#ef4444" />}
                <Text style={[styles.resultTitle, { color: importResult.imported > 0 ? '#22c55e' : '#ef4444' }]}>
                  {importResult.imported > 0 ? `成功导入 ${importResult.imported} 个视频源` : '导入失败'}
                </Text>
                {importResult.skipped > 0 && (
                  <Text style={[styles.resultSub, { color: colors.mutedForeground }]}>
                    {importResult.skipped} 个被跳过
                  </Text>
                )}
              </View>
            ) : (
              <>
                <Text style={[styles.previewSummary, { color: colors.mutedForeground }]}>
                  共解析 {preview.length} 个视频源，{validCount} 个可导入
                </Text>
                {preview.map((p, idx) => (
                  <View
                    key={idx}
                    style={[styles.previewItem, { borderColor: getStatusStyle(p.status).borderColor, backgroundColor: getStatusStyle(p.status).backgroundColor }]}
                  >
                    <View style={styles.previewIcon}>{renderStatusIcon(p.status)}</View>
                    <View style={styles.previewInfo}>
                      <View style={styles.previewNameRow}>
                        <Text style={[styles.previewName, { color: colors.text }]}>
                          {p.item.name || '未命名'}
                        </Text>
                        <View style={styles.badge}>
                          <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{p.item.code}</Text>
                        </View>
                      </View>
                      <Text style={[styles.previewUrl, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {p.item.baseUrl}
                      </Text>
                      {p.errors.length > 0 && (
                        <Text style={styles.previewError}>{p.errors[0]}</Text>
                      )}
                      {p.existingSource && (
                        <Text style={styles.previewWarn}>
                          已在库: {p.existingSource.name}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            {importResult ? (
              <Button variant="primary" size="md" fullWidth onPress={handleFinish}>
                完成
              </Button>
            ) : (
              <>
                <Button variant="secondary" size="md" onPress={() => setStep('paste')}>
                  ← 返回修改
                </Button>
                <Button variant="primary" size="md" fullWidth loading={importing} disabled={importing || validCount === 0} onPress={handleImport} leftIcon={<Save size={16} color={colors.buttonPrimaryText} />}>
                  导入 {validCount} 个
                </Button>
              </>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
