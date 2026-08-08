#!/bin/sh
# Rebuild both mocks from source. Run from this folder.
#
# Order matters: rule-create/_tags.js defines TAGS, which _v.js reads at load
# time to build the tag-group attributes. Move it and the page throws.
set -e
cd "$(dirname "$0")"

build() {  # build <src-dir> <out-file>
  { cat "$1/_shell.html"
    echo '<script>'
    cat bands/_core.js
    cat rule-create/_tags.js
    cat "$1/_v.js"
    cat "$1/_x.js"
    echo '</script>'
  } > "$2"
  echo "built $2 ($(wc -c < "$2" | tr -d ' ') bytes)"
}

build rules-tab logic-rules-map-3.html
build unified   logic-one-window.html

# Parse check without a browser — catches a syntax error before you open the file.
if command -v node > /dev/null 2>&1; then
  for f in logic-rules-map-3.html logic-one-window.html; do
    node -e "
      const fs=require('fs'),vm=require('vm');
      const s=fs.readFileSync('$f','utf8');
      new vm.Script(s.slice(s.indexOf('<script>')+8, s.lastIndexOf('</script>')));
      console.log('  parse ok: $f');
    "
  done
fi
