#!/usr/bin/env python3
"""Translate Chinese to English in source files using DeepSeek API directly.
Usage: python3 translate_file.py <path> [--mode js|py|json]
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

DEEPSEEK_KEY = os.environ.get('DEEPSEEK_API_KEY', '')
API_URL = "https://api.deepseek.com/chat/completions"

CN_CHARS = re.compile(r'[\u4e00-\u9fff]')

SYSTEM_PROMPT = """You are a precise translation tool. Your job is to translate ALL Chinese text in the provided file to English.

RULES:
1. ONLY translate Chinese text - do not change English text, code, variable names, function names, imports, numbers, or any programming syntax
2. Preserve all code logic, structure, and formatting exactly
3. Translate Chinese in: comments, docstrings, error messages, log messages, print statements, UI strings, string literals, variable names that are Chinese
4. For JavaScript/JSON: translate Chinese string VALUES, not keys or structural elements
5. For Python: translate Chinese docstrings, comments, and string values
6. Maintain the same line structure - do not reflow or reformat
7. Do NOT add any explanation, markdown formatting, or extraneous output
8. Output ONLY the translated file content, nothing else"""

def count_chinese(text):
    return len(CN_CHARS.findall(text))

def translate_via_api(content, filename):
    """Send file to DeepSeek API for translation."""
    payload = json.dumps({
        "model": "deepseek-v4-flash",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Translate ALL Chinese text in this {os.path.splitext(filename)[1][1:].upper()} file to English. Return ONLY the translated file content:\n\n{content}"}
        ],
        "temperature": 0.0,
        "max_tokens": 32000
    }).encode('utf-8')
    
    req = urllib.request.Request(API_URL, data=payload, headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {DEEPSEEK_KEY}'
    })
    
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            result = json.loads(resp.read())
            return result['choices'][0]['message']['content']
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  API error {e.code}: {body[:200]}")
        return None
    except Exception as e:
        print(f"  Request error: {e}")
        return None

def translate_file(filepath):
    """Translate a single file."""
    filename = os.path.basename(filepath)
    before = count_chinese(open(filepath, 'r', encoding='utf-8').read())
    
    if before == 0:
        print(f"  [SKIP] {filename} - no Chinese found")
        return True
    
    print(f"  [TRANSLATING] {filename} ({before} Chinese chars)")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # For large files, try up to 3 times
    for attempt in range(3):
        result = translate_via_api(content, filename)
        if result is None:
            print(f"    Attempt {attempt+1} failed, retrying...")
            time.sleep(5)
            continue
        
        # Extract code from potential markdown code blocks
        if '```' in result:
            # Look for code block
            blocks = re.findall(r'```(?:\w+)?\n(.*?)```', result, re.DOTALL)
            if blocks:
                result = blocks[0]
        
        after = count_chinese(result)
        print(f"    Chinese chars: {before} -> {after} (removed {before - after})")
        
        if after == 0:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(result)
            print(f"    ✅ {filename} - fully translated")
            return True
        elif after < before:
            # Partial success - some Chinese remains, try again
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(result)
            print(f"    ⚠️ {filename} - partially translated ({after} chars remain), retrying with result...")
            content = result
            continue
        else:
            print(f"    ❌ No progress, API didn't translate properly")
            return False
    
    return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 translate_file.py <file_path> [file2 ...]")
        sys.exit(1)
    
    if not DEEPSEEK_KEY:
        print("ERROR: DEEPSEEK_API_KEY not set in environment")
        sys.exit(1)
    
    files = sys.argv[1:]
    for filepath in files:
        if not os.path.exists(filepath):
            print(f"  [MISSING] {filepath}")
            continue
        translate_file(filepath)
        time.sleep(1)  # Rate limiting
    
    print("\nDone!")
