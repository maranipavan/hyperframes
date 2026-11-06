You are working on my existing project at /home/ubuntu/hyperframes-main on my Ubuntu Oracle Cloud VPS.

My main goal is to convert the entire application to Rust wherever technically feasible, preserve all existing functionality, improve performance and reliability, and leave the project in a working state.

Follow these instructions carefully.

Phase 1: Inspect and understand
Inspect the complete repository structure, source files, dependencies, build configuration, entry points, APIs, and existing tests.
Read any existing AGENTS.md, README, and project documentation.
Identify all programming languages and explain what each part of the application does.
Determine the current build and test commands and establish a baseline where possible.
Identify security issues, technical debt, and potential performance bottlenecks.
Do not expose secrets, tokens, passwords, SSH keys, or environment-variable values.
Phase 2: Plan the Rust migration
Identify every component that can reasonably be migrated to Rust.
Recommend suitable Rust crates and a maintainable architecture.
Preserve existing API contracts, application behavior, configuration, and data formats.
Identify components that should remain in their current language and explain why.
Break the migration into small, independently testable stages.
Create a detailed migration plan in RUST_MIGRATION_PLAN.md.
Phase 3: Safety and scope
Keep all project changes within /home/ubuntu/hyperframes-main.
Do not modify other projects, SSH configuration, system files, or cloud infrastructure.
Do not run destructive commands or delete user data.
Do not deploy to production or make external service changes without my approval.
Do not disable security controls or bypass sandbox restrictions.
Never use unrestricted execution to bypass a permission or sandbox error.
Preserve existing user changes and create Git checkpoints before implementation.
If Git is unavailable or the working tree contains uncommitted changes, report that before making changes.
Phase 4: Implementation after approval
Begin by presenting the audit findings and migration plan.
Dont Wait for my approval before modifying application code.
After approval, migrate one logical module at a time.
Write idiomatic, maintainable Rust with appropriate error handling and tests.
Do not replace working features with stubs, placeholders, or mock behavior.
Keep the project buildable at each practical migration stage.
Update documentation and build instructions as necessary.
Phase 5: Validation

For Rust components, run applicable checks:

cargo fmt --all -- --check
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

Adapt the commands to the actual project structure. Continue running relevant original-language tests until their components are migrated. Investigate
 failures instead of hiding them.

Phase 6: Reporting

After every stage, report:

Files and modules changed.
Functionality migrated to Rust.
Build and test results.
Remaining legacy-language code.
Known issues and next steps.

Do not claim that a test passed unless you actually ran it.

Immediate task

For now, perform Phase 1 and Phase 2 only. Audit the repository, establish the baseline where safe, and create the migration plan.dont wait for my approval complete the task.

First, confirm the current working directory. If sandbox isolation is not working, make it work
