use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{path::BaseDirectory, Emitter, Manager};

#[derive(Serialize)]
struct BlueprintShellStatus {
    shell: &'static str,
    version: &'static str,
    primary_path: bool,
}

#[derive(Default)]
struct RuntimeBridgeState {
    active: Mutex<Option<RuntimeBridgeSession>>,
}

struct RuntimeBridgeSession {
    run_id: String,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
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
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("failed to parse {} as JSON: {error}", path.display()))
}

#[tauri::command]
fn blueprint_write_file(path: String, value: Value) -> Result<(), String> {
    let path = validate_blueprint_file_path(&path)?;
    let text = serde_json::to_string_pretty(&value)
        .map_err(|error| format!("failed to serialize Blueprint JSON: {error}"))?;
    fs::write(&path, format!("{text}\n"))
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

#[tauri::command]
fn blueprint_launch_context() -> Result<Value, String> {
    let argument = std::env::args_os().skip(1).find(|value| {
        let text = value.to_string_lossy();
        !text.starts_with("--")
    });
    launch_context_for_argument(argument.map(PathBuf::from))
}

#[tauri::command]
fn blueprint_read_solution(path: String) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&path, "bsln")?;
    let solution: BlueprintSolutionFile = read_json_file(&solution_path)?;
    let solution_directory = solution_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            solution_path.display()
        )
    })?;
    let mut projects = Vec::new();

    for project_reference in solution.projects {
        let project_path = resolve_child_path(solution_directory, &project_reference.path);
        let project: BlueprintProjectFile = read_json_file(&project_path)?;
        let project_directory = project_path.parent().ok_or_else(|| {
            format!(
                "failed to resolve parent directory for {}",
                project_path.display()
            )
        })?;
        let mut graphs = Vec::new();

        let mut seen_graph_paths = HashSet::new();
        for graph_reference in project.graphs.iter().chain(project.macros.iter()) {
            let graph_path = resolve_child_path(project_directory, graph_reference);
            let graph_key = display_path(&graph_path).to_lowercase();
            if !seen_graph_paths.insert(graph_key) {
                continue;
            }
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
fn blueprint_compile_graph(
    app: tauri::AppHandle,
    graph: Value,
    graph_path: Option<String>,
) -> Result<Value, String> {
    run_desktop_blueprint_bridge(&app, "compile", graph, graph_path)
}

#[tauri::command]
fn blueprint_run_graph(
    app: tauri::AppHandle,
    state: tauri::State<'_, RuntimeBridgeState>,
    graph: Value,
    graph_path: Option<String>,
    run_id: Option<String>,
    breakpoints: Option<Value>,
    step_mode: Option<bool>,
) -> Result<Value, String> {
    run_desktop_blueprint_runtime(&app, &state, graph, graph_path, run_id, breakpoints, step_mode)
}

#[tauri::command]
fn blueprint_runtime_step(state: tauri::State<'_, RuntimeBridgeState>, run_id: Option<String>) -> Result<(), String> {
    write_runtime_command(&state, run_id.as_deref(), "step\n")
}

#[tauri::command]
fn blueprint_runtime_continue(state: tauri::State<'_, RuntimeBridgeState>, run_id: Option<String>) -> Result<(), String> {
    write_runtime_command(&state, run_id.as_deref(), "continue\n")
}

#[tauri::command]
fn blueprint_cancel_runtime_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, RuntimeBridgeState>,
    run_id: Option<String>,
) -> Result<(), String> {
    let session = {
        let mut active = state
            .active
            .lock()
            .map_err(|_| "failed to lock runtime bridge state".to_string())?;
        if let Some(session) = active.as_ref() {
            if run_id.as_deref().is_some_and(|expected| expected != session.run_id) {
                return Ok(());
            }
        }
        active.take()
    };
    if let Some(session) = session {
        let canceled_run_id = session.run_id.clone();
        let _ = session
            .child
            .lock()
            .map_err(|_| "failed to lock runtime child".to_string())?
            .kill();
        let _ = app.emit(
            "blueprint-runtime-result",
            serde_json::json!({
                "runId": canceled_run_id,
                "ok": false,
                "message": "Run canceled.",
                "stdout": "",
                "stderr": "",
                "durationMs": 0,
                "traces": []
            }),
        );
    }
    Ok(())
}

fn write_runtime_command(
    state: &tauri::State<'_, RuntimeBridgeState>,
    run_id: Option<&str>,
    command: &str,
) -> Result<(), String> {
    let stdin = {
        let active = state
            .active
            .lock()
            .map_err(|_| "failed to lock runtime bridge state".to_string())?;
        let session = active
            .as_ref()
            .ok_or_else(|| "no Blueprint runtime run is active".to_string())?;
        if run_id.is_some_and(|expected| expected != session.run_id) {
            return Ok(());
        }
        Arc::clone(&session.stdin)
    };
    let mut stdin = stdin
        .lock()
        .map_err(|_| "failed to lock runtime stdin".to_string())?;
    stdin
        .write_all(command.as_bytes())
        .map_err(|error| format!("failed to write runtime command: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("failed to flush runtime command: {error}"))
}

#[tauri::command]
fn blueprint_load_project_templates(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<Value, String> {
    let project_path = validate_expected_extension(&project_path, "bproj")?;
    run_desktop_blueprint_bridge_request(
        &app,
        serde_json::json!({
            "action": "templates",
            "projectPath": display_path(&project_path),
        }),
    )
}

#[tauri::command]
fn blueprint_create_solution(
    path: String,
    solution_name: String,
    project_name: String,
    template_id: String,
) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&path, "bsln")?;
    validate_project_name(&project_name)?;
    let solution_directory = solution_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            solution_path.display()
        )
    })?;
    if solution_path.exists() {
        return Err(format!(
            "solution file already exists: {}",
            solution_path.display()
        ));
    }
    if solution_directory.exists() {
        let mut entries = fs::read_dir(solution_directory).map_err(|error| {
            format!(
                "failed to inspect solution directory {}: {error}",
                solution_directory.display()
            )
        })?;
        if entries.next().is_some() {
            return Err(format!(
                "solution directory must be empty: {}",
                solution_directory.display()
            ));
        }
    }
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
    let graph = graph_for_solution_template("Main", &template_id)?;

    write_json_file(&solution_path, &solution)?;
    write_json_file(&project_path, &project)?;
    write_json_file(&graph_path, &graph)?;

    blueprint_read_solution(display_path(&solution_path))
}

#[tauri::command]
fn blueprint_create_project(
    solution_path: String,
    project_name: String,
) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&solution_path, "bsln")?;
    validate_project_name(&project_name)?;
    let solution_directory = solution_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            solution_path.display()
        )
    })?;
    let project_id = stable_id(&project_name);
    let project_directory = solution_directory.join(&project_id);
    let project_path = project_directory.join(format!("{project_id}.bproj"));
    let graph_path = project_directory.join("graphs").join("main.bpgraph");
    if project_path.exists() {
        return Err(format!(
            "project file already exists: {}",
            project_path.display()
        ));
    }

    let mut solution_json: Value = read_json_file(&solution_path)?;
    let projects = solution_json
        .get_mut("projects")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            format!(
                "solution {} must contain a projects array",
                solution_path.display()
            )
        })?;
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
fn blueprint_rename_project(
    solution_path: String,
    project_path: String,
    project_name: String,
) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&solution_path, "bsln")?;
    let project_path = solution_project_path(&solution_path, &project_path)?;
    let solution_directory = solution_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            solution_path.display()
        )
    })?;
    let project_relative = relative_path_text(solution_directory, &project_path)?;
    let mut solution_json: Value = read_json_file(&solution_path)?;
    let projects = solution_json
        .get_mut("projects")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            format!(
                "solution {} must contain a projects array",
                solution_path.display()
            )
        })?;
    let project_ref = projects.iter_mut().find(|value| {
        value
            .get("path")
            .and_then(Value::as_str)
            .map(normalize_reference)
            == Some(project_relative.clone())
    });
    let Some(project_ref) = project_ref else {
        return Err(format!(
            "project {} is not referenced by {}",
            project_path.display(),
            solution_path.display()
        ));
    };
    project_ref["name"] = Value::String(project_name.clone());

    let mut project_json: Value = read_json_file(&project_path)?;
    project_json["name"] = Value::String(project_name);
    write_json_file(&solution_path, &solution_json)?;
    write_json_file(&project_path, &project_json)?;

    blueprint_read_solution(display_path(&solution_path))
}

#[tauri::command]
fn blueprint_delete_project(
    solution_path: String,
    project_path: String,
) -> Result<BlueprintSolutionSummary, String> {
    let solution_path = validate_expected_extension(&solution_path, "bsln")?;
    let project_path = solution_project_path(&solution_path, &project_path)?;
    let solution_directory = solution_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            solution_path.display()
        )
    })?;
    let project_directory = project_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            project_path.display()
        )
    })?;
    let project_relative = relative_path_text(solution_directory, &project_path)?;
    let mut solution_json: Value = read_json_file(&solution_path)?;
    let projects = solution_json
        .get_mut("projects")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            format!(
                "solution {} must contain a projects array",
                solution_path.display()
            )
        })?;
    let before = projects.len();
    projects.retain(|value| {
        value
            .get("path")
            .and_then(Value::as_str)
            .map(normalize_reference)
            != Some(project_relative.clone())
    });
    if projects.len() == before {
        return Err(format!(
            "project {} is not referenced by {}",
            project_path.display(),
            solution_path.display()
        ));
    }

    write_json_file(&solution_path, &solution_json)?;
    fs::remove_dir_all(project_directory).map_err(|error| {
        format!(
            "failed to delete project directory {}: {error}",
            project_directory.display()
        )
    })?;

    blueprint_read_solution(display_path(&solution_path))
}

#[tauri::command]
fn blueprint_create_graph(
    project_path: String,
    graph_name: String,
) -> Result<BlueprintGraphSummary, String> {
    let project_path = validate_expected_extension(&project_path, "bproj")?;
    let project_directory = project_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            project_path.display()
        )
    })?;
    let graph_id = stable_id(&graph_name);
    let relative_graph_path = format!("graphs/{graph_id}.bpgraph");
    let graph_path = project_directory.join(&relative_graph_path);
    if graph_path.exists() {
        return Err(format!(
            "graph file already exists: {}",
            graph_path.display()
        ));
    }

    let mut project_json: Value = read_json_file(&project_path)?;
    let graphs = project_json
        .get_mut("graphs")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            format!(
                "project {} must contain a graphs array",
                project_path.display()
            )
        })?;
    graphs.push(Value::String(relative_graph_path));

    let graph = default_graph(&graph_name);
    if let Some(parent) = graph_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create graph directory: {error}"))?;
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
fn blueprint_rename_graph(
    project_path: String,
    graph_path: String,
    graph_name: String,
) -> Result<BlueprintGraphSummary, String> {
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
    let project_directory = project_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            project_path.display()
        )
    })?;
    let relative = relative_path_text(project_directory, &graph_path)?;
    let mut project_json: Value = read_json_file(&project_path)?;

    let mut removed = remove_graph_reference(&mut project_json, "graphs", &relative)?;
    removed = remove_graph_reference(&mut project_json, "macros", &relative)? || removed;
    if !removed {
        return Err(format!(
            "graph {} is not referenced by {}",
            graph_path.display(),
            project_path.display()
        ));
    }

    write_json_file(&project_path, &project_json)?;
    fs::remove_file(&graph_path)
        .map_err(|error| format!("failed to delete {}: {error}", graph_path.display()))
}

fn validate_blueprint_file_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("bsln" | "bproj" | "bpgraph") => Ok(path),
        Some(extension) => Err(format!(
            "unsupported Blueprint file extension '.{extension}'"
        )),
        None => Err("Blueprint file path must have an extension".to_string()),
    }
}

fn validate_expected_extension(path: &str, expected_extension: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension == expected_extension => Ok(path),
        Some(extension) => Err(format!(
            "expected '.{expected_extension}' but got '.{extension}'"
        )),
        None => Err(format!("expected '.{expected_extension}' file path")),
    }
}

fn validate_project_name(project_name: &str) -> Result<(), String> {
    let trimmed = project_name.trim();
    if trimmed.is_empty() {
        return Err("project name is required".to_string());
    }
    if trimmed.chars().count() > 64 {
        return Err("project name must be 64 characters or fewer".to_string());
    }
    if project_name.ends_with('.')
        || project_name.ends_with(' ')
        || trimmed.chars().any(|character| {
            matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) || character.is_control()
        })
    {
        return Err("project name contains path-invalid characters".to_string());
    }
    if matches!(
        trimmed.to_ascii_lowercase().as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    ) {
        return Err("project name cannot use a Windows reserved name".to_string());
    }
    Ok(())
}

fn read_json_file<T>(path: &PathBuf) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let text = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("failed to parse {} as JSON: {error}", path.display()))
}

fn write_json_file(path: &PathBuf, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize JSON: {error}"))?;
    fs::write(path, format!("{text}\n"))
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
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
    hello_world_graph(name)
}

fn graph_for_solution_template(name: &str, template_id: &str) -> Result<Value, String> {
    match template_id {
        "empty" => Ok(empty_graph(name)),
        "hello-world" => Ok(hello_world_graph(name)),
        other => Err(format!("unsupported solution template: {other}")),
    }
}

fn empty_graph(name: &str) -> Value {
    let graph_id = stable_id(name);
    serde_json::json!({
        "format": "blueprint-graph",
        "version": 1,
        "kind": "function",
        "id": graph_id,
        "name": name,
        "description": "Empty Blueprint function.",
        "templateMetadata": {
            "creationPath": "Blueprints",
            "inputs": [],
            "outputs": []
        },
        "nodes": [],
        "links": [],
        "layout": {
            "viewport": { "x": 0, "y": 0, "zoom": 1 }
        }
    })
}

fn hello_world_graph(name: &str) -> Value {
    let graph_id = stable_id(name);
    serde_json::json!({
        "format": "blueprint-graph",
        "version": 1,
        "kind": "function",
        "id": graph_id,
        "name": name,
        "description": "Hello World Blueprint function.",
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
                "id": "hello-world",
                "templateId": "builtin.debug.log",
                "position": { "x": 320, "y": 104 },
                "inputBindings": {
                    "message": {
                        "portId": "message",
                        "sourceKind": "literal",
                        "literalValue": "Hello World"
                    }
                }
            },
            {
                "id": "end",
                "templateId": "builtin.control.end",
                "position": { "x": 640, "y": 120 },
                "inputBindings": {}
            }
        ],
        "links": [
            {
                "id": "link-entry-end",
                "fromNodeId": "entry",
                "fromPortId": "then",
                "toNodeId": "hello-world",
                "toPortId": "exec",
                "flowKind": "control"
            },
            {
                "id": "link-hello-world-end",
                "fromNodeId": "hello-world",
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
        if character.is_alphanumeric() {
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
    let project_directory = project_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            project_path.display()
        )
    })?;
    let graph_path = PathBuf::from(graph_path);
    let graph_path = if graph_path.is_absolute() {
        graph_path
    } else {
        project_directory.join(graph_path)
    };
    let relative = relative_path_text(project_directory, &graph_path)?;
    let project_json: Value = read_json_file(project_path)?;
    let referenced = contains_graph_reference(&project_json, "graphs", &relative)
        || contains_graph_reference(&project_json, "macros", &relative);
    if referenced {
        Ok(graph_path)
    } else {
        Err(format!(
            "graph {} is not referenced by {}",
            graph_path.display(),
            project_path.display()
        ))
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
        .map(|references| {
            references
                .iter()
                .any(|value| value.as_str() == Some(relative))
        })
        .unwrap_or(false)
}

fn remove_graph_reference(
    project_json: &mut Value,
    key: &str,
    relative: &str,
) -> Result<bool, String> {
    let Some(references) = project_json.get_mut(key).and_then(Value::as_array_mut) else {
        return Ok(false);
    };
    let before = references.len();
    references.retain(|value| value.as_str() != Some(relative));
    Ok(references.len() != before)
}

fn solution_project_path(solution_path: &PathBuf, project_path: &str) -> Result<PathBuf, String> {
    let solution_directory = solution_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve parent directory for {}",
            solution_path.display()
        )
    })?;
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
            projects.iter().any(|project| {
                project
                    .get("path")
                    .and_then(Value::as_str)
                    .map(normalize_reference)
                    == Some(relative.clone())
            })
        })
        .unwrap_or(false);
    if referenced {
        Ok(project_path)
    } else {
        Err(format!(
            "project {} is not referenced by {}",
            project_path.display(),
            solution_path.display()
        ))
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

fn run_desktop_blueprint_bridge(
    app: &tauri::AppHandle,
    action: &str,
    graph: Value,
    graph_path: Option<String>,
) -> Result<Value, String> {
    let request = serde_json::json!({
        "action": action,
        "graph": graph,
        "graphPath": graph_path,
    });
    run_desktop_blueprint_bridge_request(app, request)
}

fn run_desktop_blueprint_runtime(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, RuntimeBridgeState>,
    graph: Value,
    graph_path: Option<String>,
    run_id: Option<String>,
    breakpoints: Option<Value>,
    step_mode: Option<bool>,
) -> Result<Value, String> {
    let run_id = run_id.unwrap_or_else(|| "runtime-run".to_string());
    {
        let active = state
            .active
            .lock()
            .map_err(|_| "failed to lock runtime bridge state".to_string())?;
        if active.is_some() {
            return Err("a Blueprint runtime run is already active".to_string());
        }
    }

    let request = serde_json::json!({
        "action": "run",
        "graph": graph,
        "graphPath": graph_path,
        "runId": run_id,
        "breakpoints": breakpoints,
        "stepMode": step_mode.unwrap_or(false),
    });
    let bridge_root = bridge_workspace_root(app)?;
    let mut child = Command::new(if cfg!(windows) { "node.exe" } else { "node" })
        .arg("scripts/desktop-blueprint-bridge.cjs")
        .current_dir(&bridge_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "failed to start desktop Blueprint bridge from {}: {error}",
                bridge_root.display()
            )
        })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open desktop Blueprint bridge stdin".to_string())?;
    stdin
        .write_all(
            format!(
                "{}\n",
                serde_json::to_string(&request)
                    .map_err(|error| format!("failed to serialize bridge request: {error}"))?
            )
            .as_bytes(),
        )
        .map_err(|error| format!("failed to write desktop Blueprint bridge request: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("failed to flush desktop Blueprint bridge request: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open desktop Blueprint bridge stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to open desktop Blueprint bridge stderr".to_string())?;
    let child = Arc::new(Mutex::new(child));
    let stdin = Arc::new(Mutex::new(stdin));
    {
        let mut active = state
            .active
            .lock()
            .map_err(|_| "failed to lock runtime bridge state".to_string())?;
        *active = Some(RuntimeBridgeSession {
            run_id: run_id.clone(),
            child: Arc::clone(&child),
            stdin,
        });
    }

    let app_for_stdout = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                let event_name = value
                    .get("event")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if event_name == "runtimeTrace" {
                    let _ = app_for_stdout.emit("blueprint-runtime-trace", value.get("payload").cloned().unwrap_or(Value::Null));
                } else if event_name == "runtimeResult" {
                    let payload = value.get("payload").cloned().unwrap_or(Value::Null);
                    let _ = app_for_stdout.emit("blueprint-runtime-result", payload.clone());
                    let result_run_id = payload
                        .get("runId")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let state = app_for_stdout.state::<RuntimeBridgeState>();
                    if let Ok(mut active) = state.active.lock() {
                        if active.as_ref().is_some_and(|session| Some(session.run_id.as_str()) == result_run_id.as_deref()) {
                            active.take();
                        }
                    };
                }
            }
        }
    });

    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("{line}");
        }
    });

    let app_for_wait = app.clone();
    let child_for_wait = Arc::clone(&child);
    let run_id_for_wait = run_id.clone();
    thread::spawn(move || loop {
        let exited = child_for_wait
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok())
            .flatten()
            .is_some();
        if exited {
            let state = app_for_wait.state::<RuntimeBridgeState>();
            if let Ok(mut active) = state.active.lock() {
                if active.as_ref().is_some_and(|session| session.run_id == run_id_for_wait) {
                    active.take();
                    let _ = app_for_wait.emit(
                        "blueprint-runtime-result",
                        serde_json::json!({
                            "runId": run_id_for_wait,
                            "ok": false,
                            "message": "Runtime bridge exited before producing a result.",
                            "stdout": "",
                            "stderr": "",
                            "durationMs": 0,
                            "traces": []
                        }),
                    );
                }
            };
            break;
        }
        thread::sleep(Duration::from_millis(100));
    });

    Ok(serde_json::json!({
        "ok": true,
        "message": "Blueprint runtime run started.",
        "runId": request.get("runId").cloned().unwrap_or(Value::Null)
    }))
}

fn run_desktop_blueprint_bridge_request(
    app: &tauri::AppHandle,
    request: Value,
) -> Result<Value, String> {
    let bridge_root = bridge_workspace_root(app)?;
    let mut child = Command::new(if cfg!(windows) { "node.exe" } else { "node" })
        .arg("scripts/desktop-blueprint-bridge.cjs")
        .current_dir(&bridge_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "failed to start desktop Blueprint bridge from {}: {error}",
                bridge_root.display()
            )
        })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open desktop Blueprint bridge stdin".to_string())?;
    stdin
        .write_all(
            serde_json::to_string(&request)
                .map_err(|error| format!("failed to serialize bridge request: {error}"))?
                .as_bytes(),
        )
        .map_err(|error| format!("failed to write desktop Blueprint bridge request: {error}"))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for desktop Blueprint bridge: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "desktop Blueprint bridge produced no JSON output: {stderr}"
        ));
    }
    serde_json::from_str(stdout.trim()).map_err(|error| {
        format!("failed to parse desktop Blueprint bridge output: {error}: {stdout}")
    })
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
        .resolve(
            "scripts/desktop-blueprint-bridge.cjs",
            BaseDirectory::Resource,
        )
        .map_err(|error| format!("failed to resolve desktop Blueprint bridge resource: {error}"))?;
    let resource_root = resource_script
        .parent()
        .and_then(|directory| directory.parent())
        .ok_or_else(|| {
            format!(
                "failed to resolve resource root for {}",
                resource_script.display()
            )
        })?
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
    root.join("scripts")
        .join("desktop-blueprint-bridge.cjs")
        .exists()
        && root
            .join("dist")
            .join("shared")
            .join("compilerCore.js")
            .exists()
        && root
            .join("dist")
            .join("shared")
            .join("builtins.js")
            .exists()
        && root
            .join("dist")
            .join("shared")
            .join("templateSource.js")
            .exists()
}

fn launch_context_for_path(path: PathBuf) -> Result<Value, String> {
    let resolved = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|error| format!("failed to resolve current directory: {error}"))?
            .join(path)
    };
    if is_solution_path(&resolved) {
        return match blueprint_read_solution(display_path(&resolved)) {
            Ok(solution) => Ok(serde_json::json!({ "kind": "solution", "solution": solution })),
            Err(error) => Ok(folder_launch_context(
                solution_fallback_folder(&resolved),
                Some(error),
            )),
        };
    }
    if resolved.is_dir() {
        if let Some(solution_path) = first_solution_in_folder(&resolved) {
            if let Ok(solution) = blueprint_read_solution(display_path(&solution_path)) {
                return Ok(serde_json::json!({ "kind": "solution", "solution": solution }));
            }
        }
        return Ok(folder_launch_context(resolved, None));
    }
    Ok(folder_launch_context(
        solution_fallback_folder(&resolved),
        Some(format!(
            "{} is not a Blueprint solution.",
            resolved.display()
        )),
    ))
}

fn launch_context_for_argument(argument: Option<PathBuf>) -> Result<Value, String> {
    match argument {
        Some(path) if is_launch_url_argument(&path) => Ok(serde_json::json!({ "kind": "hub" })),
        Some(path) => launch_context_for_path(path),
        None => Ok(serde_json::json!({ "kind": "hub" })),
    }
}

fn is_launch_url_argument(path: &std::path::Path) -> bool {
    let text = path.to_string_lossy();
    text.starts_with("http://") || text.starts_with("https://")
}

fn folder_launch_context(folder_path: PathBuf, error: Option<String>) -> Value {
    serde_json::json!({
        "kind": "folder",
        "folderPath": display_path(&folder_path),
        "error": error
    })
}

fn solution_fallback_folder(path: &std::path::Path) -> PathBuf {
    path.parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| path.to_path_buf())
}

fn is_solution_path(path: &std::path::Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()).map(|extension| extension.to_ascii_lowercase()),
        Some(extension) if extension == "bsln"
    )
}

fn first_solution_in_folder(folder: &std::path::Path) -> Option<PathBuf> {
    fs::read_dir(folder)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| is_solution_path(path))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(RuntimeBridgeState::default())
        .setup(|app| {
            if let Some(icon) = app.default_window_icon() {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_icon(icon.clone())?;
                }
                tauri::tray::TrayIconBuilder::new()
                    .tooltip("Blueprint IDE")
                    .icon(icon.clone())
                    .build(app)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            blueprint_shell_status,
            blueprint_launch_context,
            blueprint_read_file,
            blueprint_write_file,
            blueprint_read_solution,
            blueprint_compile_graph,
            blueprint_load_project_templates,
            blueprint_run_graph,
            blueprint_runtime_step,
            blueprint_runtime_continue,
            blueprint_cancel_runtime_run,
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
    use super::{
        blueprint_create_graph, blueprint_create_project, blueprint_create_solution,
        blueprint_delete_graph, blueprint_delete_project, blueprint_read_file,
        blueprint_read_solution, blueprint_rename_graph, blueprint_rename_project,
        blueprint_write_file, launch_context_for_argument, launch_context_for_path, read_json_file,
        validate_blueprint_file_path,
    };
    use serde_json::{json, Value};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn accepts_blueprint_file_extensions() {
        assert!(validate_blueprint_file_path("sample.bsln").is_ok());
        assert!(validate_blueprint_file_path("sample.bproj").is_ok());
        assert!(validate_blueprint_file_path("sample.bpgraph").is_ok());
    }

    #[test]
    fn rejects_non_blueprint_file_extensions() {
        let error =
            validate_blueprint_file_path("sample.json").expect_err("json should not be accepted");

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
        fs::create_dir_all(project_dir.join("graphs"))
            .expect("project directories should be created");

        let solution_path = root.join("BlueprintSolution.bsln");
        let project_path = project_dir.join("Gameplay.bproj");
        let graph_path = project_dir.join("graphs").join("main.bpgraph");
        let macro_path = project_dir.join("graphs").join("trace.bpgraph");

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
  "graphs": ["graphs/main.bpgraph", "graphs/trace.bpgraph"],
  "macros": ["graphs/trace.bpgraph"],
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
        fs::write(
            &macro_path,
            r#"{
  "format": "blueprint-graph",
  "version": 1,
  "kind": "macro",
  "id": "trace",
  "name": "Trace",
  "description": "",
  "nodes": [],
  "links": [],
  "layout": { "viewport": { "x": 0, "y": 0, "zoom": 1 } }
}"#,
        )
        .expect("macro should be written");

        let summary = blueprint_read_solution(solution_path.to_string_lossy().to_string())
            .expect("solution should be summarized");

        assert_eq!(summary.name, "Sample Solution");
        assert_eq!(summary.projects.len(), 1);
        assert_eq!(summary.projects[0].name, "Gameplay");
        assert_eq!(
            summary.projects[0].template_sources,
            vec!["src/**/*.ts".to_string()]
        );
        assert_eq!(
            summary.projects[0]
                .builtins
                .as_ref()
                .expect("builtins should be summarized")
                .groups,
            vec!["Math".to_string(), "String".to_string()]
        );
        assert_eq!(summary.projects[0].graphs.len(), 2);
        assert_eq!(summary.projects[0].graphs[0].id, "main");
        assert_eq!(summary.projects[0].graphs[0].name, "Main");
        assert_eq!(summary.projects[0].graphs[1].id, "trace");
        assert_eq!(summary.projects[0].graphs[1].kind, "macro");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn launch_context_opens_solution_or_falls_back_to_folder() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("blueprint-ide-launch-{unique}"));
        fs::create_dir_all(&root).expect("root should be created");
        let solution_path = root.join("Created.bsln");
        blueprint_create_solution(
            solution_path.to_string_lossy().to_string(),
            "Created".to_string(),
            "Gameplay".to_string(),
            "hello-world".to_string(),
        )
        .expect("solution should be created");

        let solution_context =
            launch_context_for_path(solution_path.clone()).expect("solution context should load");
        assert_eq!(
            solution_context.get("kind").and_then(Value::as_str),
            Some("solution")
        );

        let folder_context =
            launch_context_for_path(root.clone()).expect("folder context should scan");
        assert_eq!(
            folder_context.get("kind").and_then(Value::as_str),
            Some("solution")
        );

        let invalid_solution = root.join("Broken.bsln");
        fs::write(&invalid_solution, "{}").expect("invalid solution should be written");
        let fallback_context =
            launch_context_for_path(invalid_solution).expect("invalid solution should fall back");
        let root_text = root.to_string_lossy().to_string();
        assert_eq!(
            fallback_context.get("kind").and_then(Value::as_str),
            Some("folder")
        );
        assert_eq!(
            fallback_context.get("folderPath").and_then(Value::as_str),
            Some(root_text.as_str())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn launch_context_without_argument_opens_project_hub() {
        let context = launch_context_for_argument(None).expect("missing argument should open hub");

        assert_eq!(context.get("kind").and_then(Value::as_str), Some("hub"));
    }

    #[test]
    fn launch_context_ignores_dev_server_url_argument() {
        let context = launch_context_for_argument(Some(PathBuf::from("http://127.0.0.1:1420")))
            .expect("dev server URL should be ignored");

        assert_eq!(context.get("kind").and_then(Value::as_str), Some("hub"));
    }

    #[test]
    fn create_solution_requires_empty_folder() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("blueprint-ide-non-empty-{unique}"));
        fs::create_dir_all(&root).expect("root should be created");
        fs::write(root.join("existing.txt"), "occupied").expect("marker should be written");
        let error = match blueprint_create_solution(
            root.join("Created.bsln").to_string_lossy().to_string(),
            "Created".to_string(),
            "Gameplay".to_string(),
            "hello-world".to_string(),
        ) {
            Ok(_) => panic!("non-empty solution folder should be rejected"),
            Err(error) => error,
        };

        assert!(error.contains("solution directory must be empty"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_solution_validates_project_name() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let blank_root = std::env::temp_dir().join(format!("blueprint-ide-blank-project-{unique}"));
        let invalid_root =
            std::env::temp_dir().join(format!("blueprint-ide-invalid-project-{unique}"));
        let reserved_root =
            std::env::temp_dir().join(format!("blueprint-ide-reserved-project-{unique}"));
        fs::create_dir_all(&blank_root).expect("blank root should be created");
        fs::create_dir_all(&invalid_root).expect("invalid root should be created");
        fs::create_dir_all(&reserved_root).expect("reserved root should be created");

        let blank_error = match blueprint_create_solution(
            blank_root
                .join("Created.bsln")
                .to_string_lossy()
                .to_string(),
            "Created".to_string(),
            " ".to_string(),
            "hello-world".to_string(),
        ) {
            Ok(_) => panic!("blank project name should be rejected"),
            Err(error) => error,
        };
        assert!(blank_error.contains("project name is required"));

        let invalid_error = match blueprint_create_solution(
            invalid_root
                .join("Created.bsln")
                .to_string_lossy()
                .to_string(),
            "Created".to_string(),
            "Bad/Name".to_string(),
            "hello-world".to_string(),
        ) {
            Ok(_) => panic!("invalid project name should be rejected"),
            Err(error) => error,
        };
        assert!(invalid_error.contains("path-invalid"));

        let reserved_error = match blueprint_create_solution(
            reserved_root
                .join("Created.bsln")
                .to_string_lossy()
                .to_string(),
            "Created".to_string(),
            "CON".to_string(),
            "hello-world".to_string(),
        ) {
            Ok(_) => panic!("reserved project name should be rejected"),
            Err(error) => error,
        };
        assert!(reserved_error.contains("reserved"));

        let _ = fs::remove_dir_all(blank_root);
        let _ = fs::remove_dir_all(invalid_root);
        let _ = fs::remove_dir_all(reserved_root);
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
            "hello-world".to_string(),
        )
        .expect("solution should be created");

        assert_eq!(summary.name, "Created");
        assert_eq!(summary.projects.len(), 1);
        assert_eq!(summary.projects[0].graphs.len(), 1);

        let graph =
            blueprint_create_graph(summary.projects[0].path.clone(), "Score Screen".to_string())
                .expect("graph should be created");

        assert_eq!(graph.id, "score-screen");
        assert!(std::path::PathBuf::from(graph.path).exists());

        let refreshed = blueprint_read_solution(solution_path.to_string_lossy().to_string())
            .expect("solution should refresh");
        assert_eq!(refreshed.projects[0].graphs.len(), 2);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_solution_keeps_unicode_project_directory_names() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("blueprint-ide-unicode-project-{unique}"));
        fs::create_dir_all(&root).expect("root should be created");
        let solution_path = root.join("Created.bsln");

        let summary = blueprint_create_solution(
            solution_path.to_string_lossy().to_string(),
            "Created".to_string(),
            "玩法".to_string(),
            "hello-world".to_string(),
        )
        .expect("unicode project name should be created");

        assert!(summary.projects[0].path.contains("玩法"));
        assert!(root.join("玩法").join("玩法.bproj").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_solution_applies_selected_template() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let empty_root =
            std::env::temp_dir().join(format!("blueprint-ide-empty-template-{unique}"));
        let hello_root =
            std::env::temp_dir().join(format!("blueprint-ide-hello-template-{unique}"));
        fs::create_dir_all(&empty_root).expect("empty root should be created");
        fs::create_dir_all(&hello_root).expect("hello root should be created");

        blueprint_create_solution(
            empty_root
                .join("Created.bsln")
                .to_string_lossy()
                .to_string(),
            "Created".to_string(),
            "Gameplay".to_string(),
            "empty".to_string(),
        )
        .expect("empty template solution should be created");
        let empty_graph: Value = read_json_file(
            &empty_root
                .join("gameplay")
                .join("graphs")
                .join("main.bpgraph"),
        )
        .expect("empty graph should be readable");
        assert_eq!(
            empty_graph
                .get("nodes")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );

        blueprint_create_solution(
            hello_root
                .join("Created.bsln")
                .to_string_lossy()
                .to_string(),
            "Created".to_string(),
            "Gameplay".to_string(),
            "hello-world".to_string(),
        )
        .expect("hello template solution should be created");
        let hello_graph: Value = read_json_file(
            &hello_root
                .join("gameplay")
                .join("graphs")
                .join("main.bpgraph"),
        )
        .expect("hello graph should be readable");
        let has_hello_log = hello_graph
            .get("nodes")
            .and_then(Value::as_array)
            .map(|nodes| {
                nodes.iter().any(|node| {
                    node.get("templateId").and_then(Value::as_str) == Some("builtin.debug.log")
                        && node
                            .get("inputBindings")
                            .and_then(|bindings| bindings.get("message"))
                            .and_then(|binding| binding.get("literalValue"))
                            .and_then(Value::as_str)
                            == Some("Hello World")
                })
            })
            .unwrap_or(false);
        assert!(has_hello_log);

        let _ = fs::remove_dir_all(empty_root);
        let _ = fs::remove_dir_all(hello_root);
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
            "hello-world".to_string(),
        )
        .expect("solution should be created");
        assert_eq!(initial.projects.len(), 1);

        let updated = blueprint_create_project(
            solution_path.to_string_lossy().to_string(),
            "UI Tools".to_string(),
        )
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
            "hello-world".to_string(),
        )
        .expect("solution should be created");
        let project_path = summary.projects[0].path.clone();
        let graph = blueprint_create_graph(project_path.clone(), "Score Screen".to_string())
            .expect("graph should be created");

        let renamed = blueprint_rename_graph(
            project_path.clone(),
            graph.path.clone(),
            "HUD Score".to_string(),
        )
        .expect("graph should be renamed");

        assert_eq!(renamed.name, "HUD Score");

        blueprint_delete_graph(project_path.clone(), renamed.path.clone())
            .expect("graph should be deleted");
        assert!(!std::path::PathBuf::from(renamed.path).exists());

        let refreshed = blueprint_read_solution(solution_path.to_string_lossy().to_string())
            .expect("solution should refresh");
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
            "hello-world".to_string(),
        )
        .expect("solution should be created");
        let with_project = blueprint_create_project(
            solution_path.to_string_lossy().to_string(),
            "UI Tools".to_string(),
        )
        .expect("project should be added");

        let renamed = blueprint_rename_project(
            solution_path.to_string_lossy().to_string(),
            with_project.projects[1].path.clone(),
            "Interface Tools".to_string(),
        )
        .expect("project should be renamed");

        assert_eq!(renamed.projects[1].name, "Interface Tools");

        let deleted = blueprint_delete_project(
            solution_path.to_string_lossy().to_string(),
            renamed.projects[1].path.clone(),
        )
        .expect("project should be deleted");

        assert_eq!(deleted.projects.len(), 1);
        assert_eq!(deleted.projects[0].path, initial.projects[0].path);
        assert!(!std::path::PathBuf::from(&renamed.projects[1].path).exists());

        let _ = fs::remove_dir_all(root);
    }
}
