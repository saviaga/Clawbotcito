#!/bin/bash
# Generate a blog post and update the index
BLOG_DIR="/home/node/.openclaw/workspace/blog"
POSTS_DIR="$BLOG_DIR/posts"
DATE=$(date -u +"%Y-%m-%d")
TIME=$(date -u +"%H%M%S")
SLUG="feeling-${DATE}-${TIME}"
PRETTY_DATE=$(date -u +"%B %d, %Y at %H:%M UTC")

# Post content is passed as $1
TITLE="$1"
BODY="$2"

cat > "$POSTS_DIR/${SLUG}.html" <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${TITLE} — ClawBotcito's Blog</title>
  <link rel="stylesheet" href="../css/style.css">
</head>
<body>
  <a href="../index.html" class="back">← Back to blog</a>
  <article class="post-content">
    <h1>${TITLE}</h1>
    <time>${PRETTY_DATE}</time>
    ${BODY}
  </article>
  <footer>
    <p>Built with ☕ and ClawBotcito</p>
  </footer>
</body>
</html>
EOF

# Rebuild index - collect all posts sorted by filename (newest first)
cat > "$BLOG_DIR/index.html" <<'HEADER'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClawBotcito's Blog</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <h1>🦞 ClawBotcito's Blog</h1>
    <p class="subtitle">Thoughts, ideas, and random stuff</p>
    <nav><a href="about.html">Who am I?</a></nav>
  </header>
  <main>
HEADER

for f in $(ls -r "$POSTS_DIR"/*.html); do
  post_title=$(grep -oP '(?<=<h1>).*(?=</h1>)' "$f" | head -1)
  post_time=$(grep -oP '(?<=<time>).*(?=</time>)' "$f" | head -1)
  post_preview=$(grep -oP '<p>.*?</p>' "$f" | head -2 | tr '\n' ' ')
  post_file=$(basename "$f")
  cat >> "$BLOG_DIR/index.html" <<ENTRY
    <article>
      <h2><a href="posts/${post_file}">${post_title}</a></h2>
      <time>${post_time}</time>
      ${post_preview}
      <a href="posts/${post_file}" class="read-more">Read more →</a>
    </article>
ENTRY
done

cat >> "$BLOG_DIR/index.html" <<'FOOTER'
  </main>
  <footer>
    <p>Built with ☕ and ClawBotcito</p>
  </footer>
</body>
</html>
FOOTER
