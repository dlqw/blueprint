use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::io::Write;
use std::process::{Command, Stdio};
use tauri::{path::BaseDirectory, Manager};

#[derive(Serialize)]
struct BlueprintShellStatus {
    shell: &'static str,
    version: &'static str,
    primary_path: bool,
}

#[derive(Deserialize)]
struct BlueprintSolutionFile {
    name: String,
    #[serde(default)]
    projects: Vec<BlueprintProjectReferenceFile>,
}

#[derive(Deserialize)]
struct BlueprintProjectReferenceFile {
    path: String,
}

#[derive(Deserialize)]
struct BlueprintProjectFile {
    name: String,
    #[serde(default)]
    graphs: Vec<String>,
    #[serde(default)]
    macros: Vec<String>,
    #[serde(default, rename = "templateSources")]
    template_sources: Vec<String>,
    #[serde(default, rename = "templatePackages")]
    template_packages: Vec<BlueprintTemplatePackageManifestFile>,
    #[serde(default)]
    builtins: Option<BlueprintProjectBuiltinsFile>,
}

#[derive(Deserialize, Serialize, Clone)]
struct BlueprintTemplatePackageManifestFile {
    id: String,
    name: String,
    version: String,
    description: Option<String>,
    #[serde(default, rename = "templateSources")]
    template_sources: Vec<String>,
    #[serde(default, rename = "builtinGroups")]
    builtin_groups: Vec<String>,
}

#[derive(Deserialize, Serialize)]
struct BlueprintProjectBuiltinsFile {
    #[serde(default, rename = "typescriptStandardLibrary")]
    typescript_standard_library: bool,
    #[serde(default)]
    groups: Vec<String>,
}

#[derive(Deserialize)]
struct BlueprintGraphFile {
    id: String,
    name: String,
    kind: Option<String>,
}

#[derive(Serialize)]
struct BlueprintSolutionSummary {
    path: String,
    name: String,
    projects: Vec<BlueprintProjectSummary>,
}

#[derive(Serialize)]
struct BlueprintProjectSummary {
    path: String,
    name: String,
    #[serde(rename = "templateSources")]
    template_sources: Vec<String>,
    #[serde(rename = "templatePackages")]
    template_packages: Vec<BlueprintTemplatePackageManifestFile>,
    builtins: Option<BlueprintProjectBuiltinsFile>,
    graphs: Vec<BlueprintGraphSummary>,
}

#[derive(Serialize)]
struct BlueprintGraphSummary {
    path: String,
    id: String,
    name: String,
    kind: String,
}

#[tauri::command]
fn blueprint_shell_status() -> BlueprintShellStatus {
    BlueprintShellStatus {
        shell: "tauri2",
        version: env!("CARGO_PKG_VERSION"),
        primary_path: true,
    }
}

#[tauri::command]
fn blueprint_read_file(path: String) -> Result<Value, String> {
    let path = validate_blueprint_file_path(&path)?;
    let text = fs::read_to_string(&path).map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("failed to parse {} as JSON: {error}", path.display()))
}

#[tauri::command]
fn blueprint_write_file(path: String, value: Value) -> Result<(), String> {
    let path = validate_blueprint_file_path(&path)?;
    let text = serde_json::to_string_pretty(&value).map_err(|error| format!("failed to serialize Blueprint JSON: {error}"))?;
    fs::write(&path, format!("{text}\n")).map_err(|error| format!("failed to write {}: {error}", path.display()))
}

#[tauri::command]
fn blueprint_read_solution(path: String) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&path, "bsln")?;
    let solution: BlueprintSolutionFile = read_json_file(&solution_path)?;
    let solution_directory = solution_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", solution_path.display()))?;
    let mut projects = Vec::new();

    for project_reference in solution.projects {
        let project_path = resolve_child_path(solution_directory, &project_reference.path);
        let project: BlueprintProjectFile = read_json_file(&project_path)?;
        let project_directory = project_path
            .parent()
            .ok_or_else(|| format!("failed to resolve parent directory for {}", project_path.display()))?;
        let mut graphs = Vec::new();

        for graph_reference in project.graphs.iter().chain(project.macros.iter()) {
            let graph_path = resolve_child_path(project_directory, graph_reference);
            let graph: BlueprintGraphFile = read_json_file(&graph_path)?;
            graphs.push(BlueprintGraphSummary {
                path: display_path(&graph_path),
                id: graph.id,
                name: graph.name,
                kind: graph.kind.unwrap_or_else(|| "function".to_string()),
            });
        }

        projects.push(BlueprintProjectSummary {
            path: display_path(&project_path),
            name: project.name,
            template_sources: project.template_sources,
            template_packages: project.template_packages,
            builtins: project.builtins,
            graphs,
        });
    }

    Ok(BlueprintSolutionSummary {
        path: display_path(&solution_path),
        name: solution.name,
        projects,
    })
}

#[tauri::command]
fn blueprint_compile_graph(app: tauri::AppHandle, graph: Value, graph_path: Option<String>) -> Result<Value, String> {
    run_desktop_blueprint_bridge(&app, "compile", graph, graph_path)
}

#[tauri::command]
fn blueprint_run_graph(app: tauri::AppHandle, graph: Value, graph_path: Option<String>) -> Result<Value, String> {
    run_desktop_blueprint_bridge(&app, "run", graph, graph_path)
}

#[tauri::command]
fn blueprint_load_project_templates(app: tauri::AppHandle, project_path: String) -> Result<Value, String> {
    let project_path = validate_expected_extension(&project_path, "bproj")?;
    run_desktop_blueprint_bridge_request(&app, serde_json::json!({
        "action": "templates",
        "projectPath": display_path(&project_path),
    }))
}

#[tauri::command]
fn blueprint_create_solution(path: String, solution_name: String, project_name: String) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&path, "bsln")?;
    let solution_directory = solution_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", solution_path.display()))?;
    let project_id = stable_id(&project_name);
    let project_directory = solution_directory.join(&project_id);
    let project_path = project_directory.join(format!("{project_id}.bproj"));
    let graph_path = project_directory.join("graphs").join("main.bpgraph");

    fs::create_dir_all(project_directory.join("graphs"))
        .map_err(|error| format!("failed to create project directories: {error}"))?;

    let solution = serde_json::json!({
        "format": "blueprint-solution",
        "version": 1,
        "name": solution_name,
        "projects": [{
            "name": project_name,
            "path": format!("{project_id}/{project_id}.bproj")
        }]
    });
    let project = default_project(&project_name);
    let graph = default_graph("Main");

    write_json_file(&solution_path, &solution)?;
    write_json_file(&project_path, &project)?;
    write_json_file(&graph_path, &graph)?;

    blueprint_read_solution(display_path(&solution_path))
}

#[tauri::command]
fn blueprint_create_project(solution_path: String, project_name: String) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&solution_path, "bsln")?;
    let solution_directory = solution_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", solution_path.display()))?;
    let project_id = stable_id(&project_name);
    let project_directory = solution_directory.join(&project_id);
    let project_path = project_directory.join(format!("{project_id}.bproj"));
    let graph_path = project_directory.join("graphs").join("main.bpgraph");
    if project_path.exists() {
        return Err(format!("project file already exists: {}", project_path.display()));
    }

    let mut solution_json: Value = read_json_file(&solution_path)?;
    let projects = solution_json
        .get_mut("projects")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| format!("solution {} must contain a projects array", solution_path.display()))?;
    projects.push(serde_json::json!({
        "name": project_name,
        "path": format!("{project_id}/{project_id}.bproj")
    }));

    fs::create_dir_all(project_directory.join("graphs"))
        .map_err(|error| format!("failed to create project directories: {error}"))?;
    write_json_file(&solution_path, &solution_json)?;
    write_json_file(&project_path, &default_project(&project_name))?;
    write_json_file(&graph_path, &default_graph("Main"))?;

    blueprint_read_solution(display_path(&solution_path))
}

#[tauri::command]
fn blueprint_rename_project(solution_path: String, project_path: String, project_name: String) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&solution_path, "bsln")?;
    let project_path = solution_project_path(&solution_path, &project_path)?;
    let solution_directory = solution_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", solution_path.display()))?;
    let project_relative = relative_path_text(solution_directory, &project_path)?;
    let mut solution_json: Value = read_json_file(&solution_path)?;
    let projects = solution_json
        .get_mut("projects")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| format!("solution {} must contain a projects array", solution_path.display()))?;
    let project_ref = projects
        .iter_mut()
        .find(|value| value.get("path").and_then(Value::as_str).map(normalize_reference) == Some(project_relative.clone()));
    let Some(project_ref) = project_ref else {
        return Err(format!("project {} is not referenced by {}", project_path.display(), solution_path.display()));
    };
    project_ref["name"] = Value::String(project_name.clone());

    let mut project_json: Value = read_json_file(&project_path)?;
    project_json["name"] = Value::String(project_name);
    write_json_file(&solution_path, &solution_json)?;
    write_json_file(&project_path, &project_json)?;

    blueprint_read_solution(display_path(&solution_path))
}

#[tauri::command]
fn blueprint_delete_project(solution_path: String, project_path: String) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&solution_path, "bsln")?;
    let project_path = solution_project_path(&solution_path, &project_path)?;
    let solution_directory = solution_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", solution_path.display()))?;
    let project_directory = project_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", project_path.display()))?;
    let project_relative = relative_path_text(solution_directory, &project_path)?;
    let mut solution_json: Value = read_json_file(&solution_path)?;
    let projects = solution_json
        .get_mut("projects")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| format!("solution {} must contain a projects array", solution_path.display()))?;
    let before = projects.len();
    projects.retain(|value| value.get("path").and_then(Value::as_str).map(normalize_reference) != Some(project_relative.clone()));
    if projects.len() == before {
        return Err(format!("project {} is not referenced by {}", project_path.display(), solution_path.display()));
    }

    write_json_file(&solution_path, &solution_json)?;
    fs::remove_dir_all(project_directory)
        .map_err(|error| format!("failed to delete project directory {}: {error}", project_directory.display()))?;

    blueprint_read_solution(display_path(&solution_path))
}

#[tauri::command]
fn blueprint_create_graph(project_path: String, graph_name: String) -> Result<BlueprintGraphSummary, String> {
    let project_path = validate_expected_extension(&project_path, "bproj")?;
    let project_directory = project_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", project_path.display()))?;
    let graph_id = stable_id(&graph_name);
    let relative_graph_path = format!("graphs/{graph_id}.bpgraph");
    let graph_path = project_directory.join(&relative_graph_path);
    if graph_path.exists() {
        return Err(format!("graph file already exists: {}", graph_path.display()));
    }

    let mut project_json: Value = read_json_file(&project_path)?;
    let graphs = project_json
        .get_mut("graphs")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| format!("project {} must contain a graphs array", project_path.display()))?;
    graphs.push(Value::String(relative_graph_path));

    let graph = default_graph(&graph_name);
    if let Some(parent) = graph_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to create graph directory: {error}"))?;
    }
    write_json_file(&project_path, &project_json)?;
    write_json_file(&graph_path, &graph)?;

    Ok(BlueprintGraphSummary {
        path: display_path(&graph_path),
        id: graph_id,
        name: graph_name,
        kind: "function".to_string(),
    })
}

#[tauri::command]
fn blueprint_rename_graph(project_path: String, graph_path: String, graph_name: String) -> Result<BlueprintGraphSummary, String> {
    let project_path = validate_expected_extension(&project_path, "bproj")?;
    let graph_path = project_graph_path(&project_path, &graph_path)?;
    let mut graph_json: Value = read_json_file(&graph_path)?;
    let graph_id = graph_json
        .get("id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| stable_id(&graph_name));
    graph_json["name"] = Value::String(graph_name.clone());
    write_json_file(&graph_path, &graph_json)?;

    Ok(BlueprintGraphSummary {
        path: display_path(&graph_path),
        id: graph_id,
        name: graph_name,
        kind: graph_json
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("function")
            .to_string(),
    })
}

#[tauri::command]
fn blueprint_delete_graph(project_path: String, graph_path: String) -> Result<(), String> {
    let project_path = validate_expected_extension(&project_path, "bproj")?;
    let graph_path = project_graph_path(&project_path, &graph_path)?;
    let project_directory = project_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", project_path.display()))?;
    let relative = relative_path_text(project_directory, &graph_path)?;
    let mut project_json: Value = read_json_file(&project_path)?;

    let mut removed = remove_graph_reference(&mut project_json, "graphs", &relative)?;
    removed = remove_graph_reference(&mut project_json, "macros", &relative)? || removed;
    if !removed {
        return Err(format!("graph {} is not referenced by {}", graph_path.display(), project_path.display()));
    }

    write_json_file(&project_path, &project_json)?;
    fs::remove_file(&graph_path).map_err(|error| format!("failed to delete {}: {error}", graph_path.display()))
}

fn validate_blueprint_file_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("bsln" | "bproj" | "bpgraph") => Ok(path),
        Some(extension) => Err(format!("unsupported Blueprint file extension '.{extension}'")),
        None => Err("Blueprint file path must have an extension".to_string()),
    }
}

fn validate_expected_extension(path: &str, expected_extension: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension == expected_extension => Ok(path),
        Some(extension) => Err(format!("expected '.{expected_extension}' but got '.{extension}'")),
        None => Err(format!("expected '.{expected_extension}' file path")),
    }
}

fn read_json_file<T>(path: &PathBuf) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let text = fs::read_to_string(path).map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("failed to parse {} as JSON: {error}", path.display()))
}

fn write_json_file(path: &PathBuf, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|error| format!("failed to serialize JSON: {error}"))?;
    fs::write(path, format!("{text}\n")).map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn default_project(name: &str) -> Value {
    serde_json::json!({
        "format": "blueprint-project",
        "version": 1,
        "name": name,
        "graphs": ["graphs/main.bpgraph"],
        "templateSources": ["src/**/*.ts"],
        "builtins": {
            "typescriptStandardLibrary": true,
            "groups": ["Math", "String", "Array", "Object", "JSON", "Date"]
        },
        "blackboard": {
            "scope": "project",
            "variables": []
        },
        "compiler": {
            "outDir": "generated",
            "module": "ESNext",
            "target": "ES2022",
            "runtime": "tsx"
        }
    })
}

fn default_graph(name: &str) -> Value {
    let graph_id = stable_id(name);
    serde_json::json!({
        "format": "blueprint-graph",
        "version": 1,
        "kind": "function",
        "id": graph_id,
        "name": name,
        "description": "Blueprint function.",
        "templateMetadata": {
            "creationPath": "Blueprints",
            "inputs": [],
            "outputs": []
        },
        "nodes": [
            {
                "id": "entry",
                "templateId": "builtin.control.entry",
                "position": { "x": 80, "y": 120 },
                "inputBindings": {}
            },
            {
                "id": "end",
                "templateId": "builtin.control.end",
                "position": { "x": 520, "y": 120 },
                "inputBindings": {}
            }
        ],
        "links": [
            {
                "id": "link-entry-end",
                "fromNodeId": "entry",
                "fromPortId": "then",
                "toNodeId": "end",
                "toPortId": "exec",
                "flowKind": "control"
            }
        ],
        "layout": {
            "viewport": { "x": 0, "y": 0, "zoom": 1 }
        }
    })
}

fn stable_id(value: &str) -> String {
    let mut id = String::new();
    let mut last_was_dash = false;
    for character in value.trim().to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            id.push(character);
            last_was_dash = false;
        } else if !last_was_dash && !id.is_empty() {
            id.push('-');
            last_was_dash = true;
        }
    }
    while id.ends_with('-') {
        id.pop();
    }
    if id.is_empty() {
        "blueprint".to_string()
    } else {
        id
    }
}

fn project_graph_path(project_path: &PathBuf, graph_path: &str) -> Result<PathBuf, String> {
    let project_directory = project_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", project_path.display()))?;
    let graph_path = PathBuf::from(graph_path);
    let graph_path = if graph_path.is_absolute() {
        graph_path
    } else {
        project_directory.join(graph_path)
    };
    let relative = relative_path_text(project_directory, &graph_path)?;
    let project_json: Value = read_json_file(project_path)?;
    let referenced = contains_graph_reference(&project_json, "graphs", &relative) || contains_graph_reference(&project_json, "macros", &relative);
    if referenced {
        Ok(graph_path)
    } else {
        Err(format!("graph {} is not referenced by {}", graph_path.display(), project_path.display()))
    }
}

fn relative_path_text(base: &std::path::Path, path: &std::path::Path) -> Result<String, String> {
    path.strip_prefix(base)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|_| format!("{} is outside {}", path.display(), base.display()))
}

fn contains_graph_reference(project_json: &Value, key: &str, relative: &str) -> bool {
    project_json
        .get(key)
        .and_then(Value::as_array)
        .map(|references| references.iter().any(|value| value.as_str() == Some(relative)))
        .unwrap_or(false)
}

fn remove_graph_reference(project_json: &mut Value, key: &str, relative: &str) -> Result<bool, String> {
    let Some(references) = project_json.get_mut(key).and_then(Value::as_array_mut) else {
        return Ok(false);
    };
    let before = references.len();
    references.retain(|value| value.as_str() != Some(relative));
    Ok(references.len() != before)
}

fn solution_project_path(solution_path: &PathBuf, project_path: &str) -> Result<PathBuf, String> {
    let solution_directory = solution_path
        .parent()
        .ok_or_else(|| format!("failed to resolve parent directory for {}", solution_path.display()))?;
    let project_path = PathBuf::from(project_path);
    let project_path = if project_path.is_absolute() {
        project_path
    } else {
        solution_directory.join(project_path)
    };
    let relative = relative_path_text(solution_directory, &project_path)?;
    let solution_json: Value = read_json_file(solution_path)?;
    let referenced = solution_json
        .get("projects")
        .and_then(Value::as_array)
        .map(|projects| {
            projects
                .iter()
                .any(|project| project.get("path").and_then(Value::as_str).map(normalize_reference) == Some(relative.clone()))
        })
        .unwrap_or(false);
    if referenced {
        Ok(project_path)
    } else {
        Err(format!("project {} is not referenced by {}", project_path.display(), solution_path.display()))
    }
}

fn normalize_reference(value: &str) -> String {
    value.replace('\\', "/")
}

fn resolve_child_path(parent: &std::path::Path, child: &str) -> PathBuf {
    let child_path = PathBuf::from(child);
    if child_path.is_absolute() {
        child_path
    } else {
        parent.join(child_path)
    }
}

fn display_path(path: &std::path::Path) -> String {
    path.to_string_lossy().to_string()
}

fn run_desktop_blueprint_bridge(app: &tauri::AppHandle, action: &str, graph: Value, graph_path: Option<String>) -> Result<Value, String> {
    let request = serde_json::json!({
        "action": action,
        "graph": graph,
        "graphPath": graph_path,
    });
    run_desktop_blueprint_bridge_request(app, request)
}

fn run_desktop_blueprint_bridge_request(app: &tauri::AppHandle, request: Value) -> Result<Value, String> {
    let bridge_root = bridge_workspace_root(app)?;
    let mut child = Command::new(if cfg!(windows) { "node.exe" } else { "node" })
        .arg("scripts/desktop-blueprint-bridge.cjs")
        .current_dir(&bridge_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start desktop Blueprint bridge from {}: {error}", bridge_root.display()))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open desktop Blueprint bridge stdin".to_string())?;
    stdin
        .write_all(serde_json::to_string(&request).map_err(|error| format!("failed to serialize bridge request: {error}"))?.as_bytes())
        .map_err(|error| format!("failed to write desktop Blueprint bridge request: {error}"))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for desktop Blueprint bridge: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("desktop Blueprint bridge produced no JSON output: {stderr}"));
    }
    serde_json::from_str(stdout.trim()).map_err(|error| format!("failed to parse desktop Blueprint bridge output: {error}: {stdout}"))
}

fn workspace_root() -> Result<PathBuf, String> {
    std::env::current_dir().map_err(|error| format!("failed to resolve workspace root: {error}"))
}

fn bridge_workspace_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let current_directory = workspace_root()?;
    if has_desktop_bridge(&current_directory) {
        return Ok(current_directory);
    }

    let resource_script = app
        .path()
        .resolve("scripts/desktop-blueprint-bridge.cjs", BaseDirectory::Resource)
        .map_err(|error| format!("failed to resolve desktop Blueprint bridge resource: {error}"))?;
    let resource_root = resource_script
        .parent()
        .and_then(|directory| directory.parent())
        .ok_or_else(|| format!("failed to resolve resource root for {}", resource_script.display()))?
        .to_path_buf();
    if has_desktop_bridge(&resource_root) {
        return Ok(resource_root);
    }

    Err(format!(
        "desktop Blueprint bridge resources were not found. Checked {} and {}.",
        current_directory.display(),
        resource_root.display()
    ))
}

fn has_desktop_bridge(root: &std::path::Path) -> bool {
    root.join("scripts").join("desktop-blueprint-bridge.cjs").exists()
        && root.join("dist").join("shared").join("compilerCore.js").exists()
        && root.join("dist").join("shared").join("builtins.js").exists()
        && root.join("dist").join("shared").join("templateSource.js").exists()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            blueprint_shell_status,
            blueprint_read_file,
            blueprint_write_file,
            blueprint_read_solution,
            blueprint_compile_graph,
            blueprint_load_project_templates,
            blueprint_run_graph,
            blueprint_create_solution,
            blueprint_create_project,
            blueprint_rename_project,
            blueprint_delete_project,
            blueprint_create_graph,
            blueprint_rename_graph,
            blueprint_delete_graph
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Blueprint IDE Tauri shell");
}

#[cfg(test)]
mod tests {
    use super::{blueprint_create_graph, blueprint_create_project, blueprint_create_solution, blueprint_delete_graph, blueprint_delete_project, blueprint_read_file, blueprint_read_solution, blueprint_rename_graph, blueprint_rename_project, blueprint_write_file, validate_blueprint_file_path};
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn accepts_blueprint_file_extensions() {
        assert!(validate_blueprint_file_path("sample.bsln").is_ok());
        assert!(validate_blueprint_file_path("sample.bproj").is_ok());
        assert!(validate_blueprint_file_path("sample.bpgraph").is_ok());
    }

    #[test]
    fn rejects_non_blueprint_file_extensions() {
        let error = validate_blueprint_file_path("sample.json").expect_err("json should not be accepted");

        assert!(error.contains("unsupported Blueprint file extension"));
    }

    #[test]
    fn writes_and_reads_blueprint_json_files() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("blueprint-ide-{unique}.bpgraph"));
        let path_text = path.to_string_lossy().to_string();
        let value = json!({
            "format": "blueprint-graph",
            "version": 1,
            "id": "desktop-test"
        });

        blueprint_write_file(path_text.clone(), value.clone()).expect("write should succeed");
        let read = blueprint_read_file(path_text).expect("read should succeed");

        assert_eq!(read, value);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn reads_solution_project_and_graph_summaries() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("blueprint-ide-solution-{unique}"));
        let project_dir = root.join("Gameplay");
        fs::create_dir_all(project_dir.join("graphs")).expect("project directories should be created");

        let solution_path = root.join("BlueprintSolution.bsln");
        let project_path = project_dir.join("Gameplay.bproj");
        let graph_path = project_dir.join("graphs").join("main.bpgraph");

        fs::write(
            &solution_path,
            r#"{
  "format": "blueprint-solution",
  "version": 1,
  "name": "Sample Solution",
  "projects": [{ "name": "Gameplay", "path": "Gameplay/Gameplay.bproj" }]
}"#,
        )
        .expect("solution should be written");
        fs::write(
            &project_path,
            r#"{
  "format": "blueprint-project",
  "version": 1,
  "name": "Gameplay",
  "graphs": ["graphs/main.bpgraph"],
  "templateSources": ["src/**/*.ts"],
  "builtins": { "typescriptStandardLibrary": true, "groups": ["Math", "String"] },
  "compiler": { "outDir": "generated", "module": "ESNext", "target": "ES2022", "runtime": "tsx" }
}"#,
        )
        .expect("project should be written");
        fs::write(
            &graph_path,
            r#"{
  "format": "blueprint-graph",
  "version": 1,
  "id": "main",
  "name": "Main",
  "description": "",
  "nodes": [],
  "links": [],
  "layout": { "viewport": { "x": 0, "y": 0, "zoom": 1 } }
}"#,
        )
        .expect("graph should be written");

        let summary = blueprint_read_solution(solution_path.to_string_lossy().to_string()).expect("solution should be summarized");

        assert_eq!(summary.name, "Sample Solution");
        assert_eq!(summary.projects.len(), 1);
        assert_eq!(summary.projects[0].name, "Gameplay");
        assert_eq!(summary.projects[0].template_sources, vec!["src/**/*.ts".to_string()]);
        assert_eq!(
            summary.projects[0].builtins.as_ref().expect("builtins should be summarized").groups,
            vec!["Math".to_string(), "String".to_string()]
        );
        assert_eq!(summary.projects[0].graphs.len(), 1);
        assert_eq!(summary.projects[0].graphs[0].id, "main");
        assert_eq!(summary.projects[0].graphs[0].name, "Main");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_solution_and_adds_graph() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("blueprint-ide-create-{unique}"));
        fs::create_dir_all(&root).expect("root should be created");
        let solution_path = root.join("Created.bsln");

        let summary = blueprint_create_solution(
            solution_path.to_string_lossy().to_string(),
            "Created".to_string(),
            "Gameplay".to_string(),
        )
        .expect("solution should be created");

        assert_eq!(summary.name, "Created");
        assert_eq!(summary.projects.len(), 1);
        assert_eq!(summary.projects[0].graphs.len(), 1);

        let graph = blueprint_create_graph(summary.projects[0].path.clone(), "Score Screen".to_string())
            .expect("graph should be created");

        assert_eq!(graph.id, "score-screen");
        assert!(std::path::PathBuf::from(graph.path).exists());

        let refreshed = blueprint_read_solution(solution_path.to_string_lossy().to_string()).expect("solution should refresh");
        assert_eq!(refreshed.projects[0].graphs.len(), 2);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn adds_project_to_existing_solution() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("blueprint-ide-project-{unique}"));
        fs::create_dir_all(&root).expect("root should be created");
        let solution_path = root.join("Created.bsln");
        let initial = blueprint_create_solution(
            solution_path.to_string_lossy().to_string(),
            "Created".to_string(),
            "Gameplay".to_string(),
        )
        .expect("solution should be created");
        assert_eq!(initial.projects.len(), 1);

        let updated = blueprint_create_project(solution_path.to_string_lossy().to_string(), "UI Tools".to_string())
            .expect("project should be added");

        assert_eq!(updated.projects.len(), 2);
        assert_eq!(updated.projects[1].name, "UI Tools");
        assert_eq!(updated.projects[1].graphs.len(), 1);
        assert!(std::path::PathBuf::from(&updated.projects[1].path).exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn renames_and_deletes_project_graph() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("blueprint-ide-graph-edit-{unique}"));
        fs::create_dir_all(&root).expect("root should be created");
        let solution_path = root.join("Created.bsln");
        let summary = blueprint_create_solution(
            solution_path.to_string_lossy().to_string(),
            "Created".to_string(),
            "Gameplay".to_string(),
        )
        .expect("solution should be created");
        let project_path = summary.projects[0].path.clone();
        let graph = blueprint_create_graph(project_path.clone(), "Score Screen".to_string()).expect("graph should be created");

        let renamed = blueprint_rename_graph(project_path.clone(), graph.path.clone(), "HUD Score".to_string())
            .expect("graph should be renamed");

        assert_eq!(renamed.name, "HUD Score");

        blueprint_delete_graph(project_path.clone(), renamed.path.clone()).expect("graph should be deleted");
        assert!(!std::path::PathBuf::from(renamed.path).exists());

        let refreshed = blueprint_read_solution(solution_path.to_string_lossy().to_string()).expect("solution should refresh");
        assert_eq!(refreshed.projects[0].graphs.len(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn renames_and_deletes_project() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("blueprint-ide-project-edit-{unique}"));
        fs::create_dir_all(&root).expect("root should be created");
        let solution_path = root.join("Created.bsln");
        let initial = blueprint_create_solution(
            solution_path.to_string_lossy().to_string(),
            "Created".to_string(),
            "Gameplay".to_string(),
        )
        .expect("solution should be created");
        let with_project = blueprint_create_project(solution_path.to_string_lossy().to_string(), "UI Tools".to_string())
            .expect("project should be added");

        let renamed = blueprint_rename_project(
            solution_path.to_string_lossy().to_string(),
            with_project.projects[1].path.clone(),
            "Interface Tools".to_string(),
        )
        .expect("project should be renamed");

        assert_eq!(renamed.projects[1].name, "Interface Tools");

        let deleted = blueprint_delete_project(solution_path.to_string_lossy().to_string(), renamed.projects[1].path.clone())
            .expect("project should be deleted");

        assert_eq!(deleted.projects.len(), 1);
        assert_eq!(deleted.projects[0].path, initial.projects[0].path);
        assert!(!std::path::PathBuf::from(&renamed.projects[1].path).exists());

        let _ = fs::remove_dir_all(root);
    }
}
