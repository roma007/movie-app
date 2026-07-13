#!/bin/bash

DB_PATH="/Users/mengfeng/Library/Application Support/com.movie.app.desktop/movieapp.db"
BASE_URL="https://www.mdzyapi.com/api.php/provide/vod"

echo "=== 开始采集测试 ==="

LIST_RESPONSE=$(curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "$BASE_URL?ac=list&pg=1&limit=5")
echo "列表响应长度: ${#LIST_RESPONSE}"

VOD_IDS=$(echo "$LIST_RESPONSE" | grep -o '"vod_id":[0-9]*' | cut -d: -f2 | head -5)
echo "获取到的 vod_id: $VOD_IDS"

total_inserted=0

for vod_id in $VOD_IDS; do
    echo -e "\n处理 vod_id: $vod_id"
    
    DETAIL_RESPONSE=$(curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "$BASE_URL?ac=detail&ids=$vod_id")
    echo "详情响应长度: ${#DETAIL_RESPONSE}"
    
    vod_name=$(echo "$DETAIL_RESPONSE" | grep -o '"vod_name":"[^"]*"' | cut -d'"' -f4 | head -1)
    vod_year=$(echo "$DETAIL_RESPONSE" | grep -o '"vod_year":"[^"]*"' | cut -d'"' -f4 | head -1)
    type_name=$(echo "$DETAIL_RESPONSE" | grep -o '"type_name":"[^"]*"' | cut -d'"' -f4 | head -1)
    vod_pic=$(echo "$DETAIL_RESPONSE" | grep -o '"vod_pic":"[^"]*"' | cut -d'"' -f4 | head -1)
    vod_area=$(echo "$DETAIL_RESPONSE" | grep -o '"vod_area":"[^"]*"' | cut -d'"' -f4 | head -1)
    vod_tag=$(echo "$DETAIL_RESPONSE" | grep -o '"vod_tag":"[^"]*"' | cut -d'"' -f4 | head -1)
    vod_director=$(echo "$DETAIL_RESPONSE" | grep -o '"vod_director":"[^"]*"' | cut -d'"' -f4 | head -1)
    vod_actor=$(echo "$DETAIL_RESPONSE" | grep -o '"vod_actor":"[^"]*"' | cut -d'"' -f4 | head -1)
    vod_blurb=$(echo "$DETAIL_RESPONSE" | grep -o '"vod_blurb":"[^"]*"' | cut -d'"' -f4 | head -1)
    vod_total=$(echo "$DETAIL_RESPONSE" | grep -o '"vod_total":[0-9]*' | cut -d: -f2 | head -1)
    
    echo "标题: $vod_name"
    echo "年份: $vod_year"
    
    if [ -z "$vod_year" ] || [ "$vod_year" -lt 2025 ]; then
        echo "跳过: 年份 < 2025"
        continue
    fi
    
    fingerprint="source_mdzuzi_$vod_id"
    
    existing=$(sqlite3 "$DB_PATH" "SELECT id FROM media WHERE fingerprint = '$fingerprint'")
    if [ -n "$existing" ]; then
        echo "跳过: 已存在"
        continue
    fi
    
    media_id="media_$vod_id"
    now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    
    sqlite3 "$DB_PATH" <<EOF
INSERT INTO media (id, title, original_title, type, year, area, genre, director, cast, description, poster_url, status, fingerprint, current_episodes, total_episodes, is_short_drama, created_at, updated_at) 
VALUES ('$media_id', '$vod_name', '$vod_name', '$type_name', $vod_year, '$vod_area', '$vod_tag', '$vod_director', '$vod_actor', '$vod_blurb', '$vod_pic', '播放中', '$fingerprint', $vod_total, $vod_total, 0, '$now', '$now');
EOF
    
    if [ $? -eq 0 ]; then
        echo "插入成功: $vod_name"
        total_inserted=$((total_inserted + 1))
    else
        echo "插入失败: $vod_name"
    fi
done

echo -e "\n=== 采集完成，共插入 $total_inserted 条数据 ==="

count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM media")
echo "数据库中共有 $count 条媒体数据"