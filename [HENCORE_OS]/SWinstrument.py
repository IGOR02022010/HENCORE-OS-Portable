import os
import posixpath

def list_files_to_file(output_filename=".$SYSTEM_DATA$.txt", root_dir="."):

    file_paths = []

    for dirpath, dirnames, filenames in os.walk(root_dir):
        for filename in filenames:
            relative_path = os.path.relpath(os.path.join(dirpath, filename), root_dir)


            if os.path.normpath(relative_path) == os.path.normpath(output_filename):
                continue


            relative_path = relative_path.replace(os.sep, "/")
            file_paths.append( relative_path)

    with open(output_filename, "w", encoding="utf-8") as f:
        for path in file_paths:
            safe_path = path.replace("'", "\\'")
            f.write(f"  '{safe_path}',\n")

if __name__ == "__main__":
    list_files_to_file(".$SYSTEM_DATA$.txt")
    print("Файл .$SYSTEM_DATA$.txt успешно создан!")

