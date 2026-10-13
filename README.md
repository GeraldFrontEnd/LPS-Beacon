<h1>LPS Beacon Agentic Forecast Bot </h1>

Resource Planning Forecast Chatbot — an AI-powered assistant that turns messy project, pipeline, workforce and financial planning files into headcount forecasts, supply-versus-demand analysis, resource matching and monthly forecast reports, all through a natural-language chat interface.

Upload your planning files, ask questions in plain English, and get cleaned data, forecasts, charts and downloadable reports back in the same conversation.

<h2>Table of contents</h2>
What the chatbot does
Capabilities and features
Example conversations
Architecture
How data flows
Data pipeline: cleaning and standardisation
Forecasting approach
Triggers
Security and access control
Data storage layout
API reference
Chat history model
Estimated cost
Design decisions
Getting started
Proposed repository layout
Roadmap
What the chatbot does

LPS-Beacon is the single front door for resource planning work. Instead of manually reconciling spreadsheets, a planner opens the web app, signs in, drops in their files and talks to the assistant.

<h2>Overall Workflow</h2>
Behind the chat window, serverless AWS services:
Receive the uploaded files (typically 10–12 CSV/XLSX files per batch).
Clean and standardise them: duplicates, shifted headers, inconsistent names, Excel date serials and wide month columns are all handled automatically.
Match demand (quote lines, resource plans, project pipeline) against supply (staff lists, HR headcount, utilisation) by grade, month and location.
Forecast demand, headcount and capacity with statistical models.
Explain the results with a large language model (Amazon Bedrock) in plain language, including the assumptions behind the numbers.
Return charts, tables, a data-quality report and downloadable reports to the chat, and email a summary when scheduled runs finish.

The assistant is the Resource Planning Forecast Agent: a Bedrock-hosted Claude model that decides which tool to call (run a forecast, fetch results, run a what-if) while the numerical work is done by deterministic Python code. This keeps forecasts repeatable and auditable; the model explains and reasons over the numbers rather than computing them.

<h2>Capabilities and features</h2>

1. Conversational interface
Feature	Description
Natural-language chat	Ask for forecasts, comparisons, explanations and what-if scenarios in everyday language.
Streaming-style answers with charts	Replies include rendered charts (Plotly), forecast tables and data-quality summaries, not just text.
Chat history sidebar	Every conversation is saved per user and listed newest-first in a sidebar; open any past chat to reload its messages and re-render its charts.
Auto-titled chats	The first message generates a short title (for example, "Grade 7 shortfall Q3").
Rename and delete chats	Users manage their own history; chats expire automatically under a configurable retention period.
Run references	Answers cite the forecast run they came from, so every number can be traced back.

2. File upload and ingestion
Feature	Description
Batch uploads	Drag and drop 10–12 CSV/XLSX files at once; the batch is treated as one unit of work.
Direct-to-storage upload	Files go straight from the browser to S3 using short-lived pre-signed URLs, so large files never pass through the API.
One run per batch	A manifest.json written last signals that the batch is complete, so a 12-file upload triggers one pipeline run, not twelve.
Duplicate-file detection	Identical files (matched by SHA-256 fingerprint) are skipped.
Format-agnostic detection	Sheets and header rows are found by column signature, not by file name or fixed position.


3. Data cleaning and standardisation

The pipeline is built for noisy planning data, including:

Header rows that are not on row 1, and extra title or "data as of" rows.
Several small tables side by side on one sheet.
Wide month layouts (May…March columns plus a fiscal-year column) that need unpivoting to one row per month.
Excel serial dates, mixed date formats and hidden or zero-width characters in headers.
Inconsistent naming (for example "Generic 4" and "Generic Resource 4").
Exact and business-key duplicates, resolved by the latest modified date.
Leavers, unknown IT codes and missing grades, which are quarantined rather than silently dropped.

Every run produces a data-quality report (what was removed, what was quarantined and why) that appears in the chat and is passed to the model, so the assistant can say "the Grade 7 gap excludes 12 people with a missing grade".

4. Forecasting and analysis
Capability	What you get
Demand forecast	Monthly resource demand by grade, skill and location from quote lines, resource plans and pipeline data.
Headcount forecast	Projected headcount requirement by month and quarter.
Resource matching	Supply-versus-demand comparison by grade, month and city, with the gap and the people or roles driving it.
Capacity analysis	Capacity and utilisation trends, bench cost shown separately from project cost, and shortfall or surplus highlights.
Monthly and quarterly forecasts	Scheduled runs on the latest cleaned data, including a quarter-horizon view.
What-if scenarios	Change an assumption in chat (add hires, slip a project, change a start date) and get the result as a delta against the baseline.
Stated assumptions	Forecasts list the assumptions and data limits behind them; thin history is flagged, and synthetic data, where used, is clearly marked.

5. Reports and notifications
Feature	Description
Monthly forecast report	Excel and CSV outputs written to storage for each run (PDF is on the roadmap).
In-chat results	The same forecast table and charts, rendered in the conversation.
Email notifications	Run complete, shortfall detected, stale-data reminder and failure alerts, sent through Amazon SNS with a link back to the app.
Audit trail	Accept, edit and reject actions are logged with user and timestamp.

6. Security and administration
Email and password sign-in with required authenticator-app MFA (Amazon Cognito).
Per-user data isolation: uploads and chat history are scoped by the verified user ID.
AWS WAF in front of the app, least-privilege IAM per function, encrypted private buckets and a full CloudTrail audit trail.
Per-user daily chat limit and a monthly spend alert to keep model costs predictable.
