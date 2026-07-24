#!/bin/bash

APP_PACKAGE="com.movie.app"
APP_ACTIVITY="com.movie.app/.MainActivity"

DEVICE=$(adb devices | grep -w "device" | head -1 | awk '{print $1}')

if [ -z "$DEVICE" ]; then
  echo "没有检测到运行中的模拟器，正在启动..."
  EMULATOR=$(emulator -list-avds | head -1)
  if [ -z "$EMULATOR" ]; then
    echo "错误: 没有找到可用的 AVD，请先在 Android Studio 中创建模拟器"
    exit 1
  fi
  echo "启动模拟器: $EMULATOR"
  emulator -avd "$EMULATOR" &
  echo "等待模拟器启动..."
  adb wait-for-device
  adb shell getprop sys.boot_completed > /dev/null 2>&1
  while [ "$(adb shell getprop sys.boot_completed 2>/dev/null)" != "1" ]; do
    sleep 2
  done
  echo "模拟器已启动"
fi

echo "正在启动 $APP_PACKAGE ..."
adb shell am start -n "$APP_ACTIVITY"
echo "已发送启动命令"
