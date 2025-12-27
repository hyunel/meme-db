SELECT
    ocr_text AS original,
    trim(regexp_replace(ocr_text, '(?i)(?:key\s+)?frame\s+\d+/\d+\n?', '', 'g')) AS cleaned
FROM meme_info
WHERE ocr_text ~* '(?:key\s+)?frame\s+\d+/\d+';
