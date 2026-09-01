fn main() {
    let client_id = std::env::var("GITHUB_CLIENT_ID")
        .or_else(|_| std::env::var("OPEN_PAGES_GITHUB_CLIENT_ID"))
        .unwrap_or_default();
    println!("cargo:rustc-env=OPEN_PAGES_EMBEDDED_GITHUB_CLIENT_ID={client_id}");
    println!("cargo:rerun-if-env-changed=GITHUB_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=OPEN_PAGES_GITHUB_CLIENT_ID");
    tauri_build::build()
}
