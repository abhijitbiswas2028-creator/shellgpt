import subprocess
import os

def run(cmd):
    return subprocess.check_output(cmd, shell=True, text=True)

# Get all deleted files in HEAD
out = run("git show HEAD --name-status | grep '^D'")
deleted_files = []
for line in out.strip().split('\n'):
    if not line: continue
    parts = line.split('\t')
    if len(parts) >= 2:
        f = parts[1]
        if 'hermes' in f.lower():
            deleted_files.append(f)

print(f"Found {len(deleted_files)} deleted hermes files.")

# Batch checkout
batch_size = 200
for i in range(0, len(deleted_files), batch_size):
    batch = deleted_files[i:i+batch_size]
    # Quote files
    batch_quoted = " ".join([f"'{f}'" for f in batch])
    run(f"git checkout HEAD^ -- {batch_quoted}")

print("Checked out all files.")

for f in deleted_files:
    # Read content
    if not os.path.exists(f): continue
    
    with open(f, 'rb') as fp:
        content = fp.read()
    
    # For text files, do replacements
    try:
        text = content.decode('utf-8')
        text = text.replace('hermes', 'shellgpt')
        text = text.replace('Hermes', 'ShellGPT')
        text = text.replace('HERMES', 'SHELLGPT')
        content = text.encode('utf-8')
    except UnicodeDecodeError:
        pass # Binary file, keep content as is
        
    # Calculate new path
    new_f = f.replace('hermes', 'shellgpt').replace('Hermes', 'ShellGPT').replace('HERMES', 'SHELLGPT')
    
    if new_f != f:
        # Ensure new directory exists
        new_dir = os.path.dirname(new_f)
        if new_dir:
            os.makedirs(new_dir, exist_ok=True)
            
        # Write to new path
        with open(new_f, 'wb') as fp:
            fp.write(content)
            
        # Remove old file
        os.remove(f)
    else:
        # Just write updated content back
        with open(f, 'wb') as fp:
            fp.write(content)

print("Files modified and renamed. Adding to git...")
run("git add .")
run("git rm -r --cached .hermes-docker || true") # clean up old stuff just in case
print("Done.")
