# DEV-09B personal engineering workbench and local EE demo

Reference: C:/Users/29557/Downloads/ai工作台演示/ai工作台演示2.
The reference is a static local prototype, not a source of authoritative states or model responses.

Implement its dark navigation rail, project context, work overview, engineering flow/list, conversations, requirements, capabilities, input files, artifacts and task views over the existing PC backend. Show actual MCP-derived Requirement/Function/SSTS/link facts and existing PC task/artifact state. Distinguish missing evidence from completion; synthetic data is explicitly labelled local demo data.

Keep existing SSTS workflow and controlled approval behavior available within the new shell. MCP is grouped by business purpose with explicit READ/approval/recovery policies, stable protocol names and schema-driven tool forms. Aggregate views still pass through the real Gateway and live EE authorization.

Deploy separate local EE API, EE MCP, PC API, Runtime, isolated EE MySQL 8.0.39, PC PostgreSQL 17 and nginx services, with named durable volumes and only a new loopback Web port 18091. Preserve DEV-09A at 18090 and all previous data. Use existing dependency/runtime versions. Do not start bots, Neo4j, production services or remote connections.

Initialize only the isolated demo database using existing schema definitions. Seed two fictional engineering projects with linked requirements/functions/specification sections, missing evidence and draft/in_review states. Seed PC tasks and actual Resource uploads without fabricating AI output. Re-running seed must not overwrite reviews, edits or duplicate work.

Verify real MCP reads/authorization, durable restarts, actual model draft workflow, independent controlled approval, UI navigation/search/filter/details, and 1440/1100 desktop screenshots. No commits, .env/schema source edits, DSH Core changes, prune or volume deletion.
