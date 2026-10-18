LPS-Beacon GitHub Collaboration Workflow Guide
Version: 1.0

Document Purpose
This guide defines the standard GitHub workflow for all contributors working on the LPS-Beacon project.

Current Contributors:

Gerald
Derek
Backend Developers
Future Project Contributors
This guide explains:

GitHub Desktop workflow
Git command line workflow
Why each step is important
Common mistakes to avoid
Merge conflict prevention
Pull Request workflow
Project Branch Strategy
Repository Structure
main
├── gerald_frontend
├── derekv2
└── feature_backend
Main Branch
The main branch should always be:

Stable
Deployable
Production-ready
Reviewed
Feature Branches
Each developer should work only in their assigned branch.

Examples:

gerald_frontend

derekv2

feature_backend
Golden Rules
✅ Develop inside your own branch

✅ Commit frequently

✅ Push frequently

✅ Sync with main daily

✅ Create Pull Requests

❌ Never develop directly on main

❌ Never force push main

❌ Never overwrite another developer's work

Daily Startup Workflow
Purpose:

Before writing new code, update your local repository to ensure you are working with the latest project version.

Step 1 - Fetch Origin
GitHub Desktop
Click:

Fetch Origin
Git CLI
git fetch origin
Why This Step Is Important
Fetch downloads the latest information from GitHub without changing your local files.

It updates:

origin/main
origin/gerald_frontend
origin/derekv2
This allows Git to know:

New commits exist
New branches exist
Other developers have pushed changes
What Happens If You Skip This Step?
You may:

Work on outdated code
Miss teammate updates
Increase the chance of merge conflicts
Step 2 - Update Local Main Branch
GitHub Desktop
Switch to:

main
Click:

Pull Origin
Git CLI
git switch main

git pull origin main
Why This Step Is Important
The main branch is the team's source of truth.

Updating local main ensures:

Latest approved code is available
Latest bug fixes are available
Latest features are available
What Happens If You Skip This Step?
Your branch may be based on obsolete code.

Merge conflicts become much more likely.

Step 3 - Sync Your Branch With Main
GitHub Desktop
Switch to your branch.

Example:

gerald_frontend
Then:

Branch
→ Update From Main
Git CLI
Example:

git switch gerald_frontend

git merge main
Why This Step Is Important
This brings all approved changes from main into your working branch.

Benefits:

Earlier conflict detection
Easier Pull Requests
Better team synchronization
What Happens If You Skip This Step?
You may continue coding on old code for days.

Later, large and difficult merge conflicts may occur.

Step 4 - Begin Development
Examples:

React pages
Components
API integration
Documentation
Architecture diagrams
Why This Step Is Important
Development should always happen inside feature branches.

This protects main from accidental bugs.

Step 5 - Review Your Changes
GitHub Desktop
Open:

Changes
Review every file.

Git CLI
git status
Why This Step Is Important
Ensure Git sees exactly what you expect.

Check for:

Accidental changes
Temporary files
Debug code
Secrets
What Happens If You Skip This Step?
You may accidentally upload:

.env

node_modules

temporary files

test code
Step 6 - Stage Changes
GitHub Desktop
Select files using checkboxes.

Git CLI
Stage everything:

git add .
Stage one file:

git add README.md
Why This Step Is Important
Staging allows you to control exactly what enters the next commit.

Benefits:

Cleaner commit history
Easier troubleshooting
Better code reviews
What Happens If You Skip This Step?
Git cannot create a commit.

No changes will be recorded.

Step 7 - Create Commit
GitHub Desktop
Enter summary:

Add Cognito Integration
Click:

Commit To Branch
Git CLI
git commit -m "Add Cognito integration"
Why This Step Is Important
A commit creates a checkpoint.

Benefits:

Rollback capability
Project history
Easier debugging
What Happens If You Skip This Step?
Changes remain local.

No one else can access them.

Step 8 - Push Changes
GitHub Desktop
Click:

Push Origin
Git CLI
Example:

git push origin gerald_frontend
Why This Step Is Important
Push uploads commits to GitHub.

Benefits:

Backup your work
Share changes
Enable Pull Requests
Enable CI/CD pipelines
What Happens If You Skip This Step?
Your work exists only on your machine.

If the laptop fails:

Work may be lost.
Step 9 - Verify GitHub
GitHub Website
Select branch:

gerald_frontend
Verify:

Files uploaded
Commits visible
No missing changes
Why This Step Is Important
Confirms successful upload.

Provides confidence before creating Pull Requests.

Pull Request Workflow
After development is complete.

Step 10 - Update Branch Before PR
GitHub Desktop
Fetch Origin

Switch Main

Pull Origin

Switch Branch

Update From Main
Git CLI
git fetch origin

git switch main

git pull origin main

git switch gerald_frontend

git merge main
Why This Step Is Important
Ensures your Pull Request contains the latest version of the codebase.

What Happens If You Skip This Step?
You may discover merge conflicts after opening a Pull Request.

Step 11 - Push Updated Branch
GitHub Desktop
Push Origin
Git CLI
git push origin gerald_frontend
Why This Step Is Important
Uploads latest merged changes before review.

Step 12 - Create Pull Request
GitHub:

Pull Requests

→ New Pull Request
Select:

Base Branch:
main

Compare Branch:
gerald_frontend
Why This Step Is Important
Pull Requests:

Prevent accidental merges
Enable peer review
Enable testing
Show code differences
What Happens If You Skip This Step?
Direct merges can:

Break production
Introduce bugs
Overwrite code
Merge Conflict Prevention
The best way to avoid conflicts:

Every morning:

git fetch origin

git switch main

git pull origin main

git switch my_branch

git merge main
Why This Works
Small updates are easy for Git to merge.

Large updates are difficult.

The more frequently branches are synchronized:

Fewer conflicts
Easier reviews
Faster development
Merge Conflict Resolution
Example:

<<<<<<< HEAD
Forecast Portal
=======
Resource Portal
>>>>>>> main
Choose the correct version.

Remove conflict markers.

Save file.

Complete Resolution
git add .

git commit -m "Resolve merge conflict"

git push origin my_branch
Why This Is Important
Git cannot complete merges automatically when conflicting changes occur.

Developers must explicitly choose the desired outcome.

Daily Developer Workflow Example
Gerald
Morning:

git fetch origin

git switch main

git pull origin main

git switch gerald_frontend

git merge main
Develop feature.

Commit:

git add .

git commit -m "Add dashboard"
Push:

git push origin gerald_frontend
Create Pull Request:

gerald_frontend
↓

main
Derek
Morning:

git fetch origin

git switch main

git pull origin main

git switch derekv2

git merge main
Continue development.

Repeat commit and push workflow.

Quick Reference Commands
Check Status
git status
Purpose:

See current file changes
Fetch Updates
git fetch origin
Purpose:

Download latest repository information
Pull Main
git pull origin main
Purpose:

Update local main
Switch Branch
git switch branch_name
Purpose:

Move between branches
Stage Files
git add .
Purpose:

Prepare files for commit
Commit Files
git commit -m "message"
Purpose:

Create project checkpoint
Push Files
git push origin branch_name
Purpose:

Upload commits to GitHub
Merge Main Into Branch
git merge main
Purpose:

Synchronize latest approved changes
Final Team Standard
Every Developer Should Follow:

git fetch origin

git switch main

git pull origin main

git switch my_branch

git merge main

git status

git add .

git commit -m "meaningful message"

git push origin my_branch
Before Every Pull Request:

git fetch origin

git switch main

git pull origin main

git switch my_branch

git merge main

git push origin my_branch
Then:

Create Pull Request

my_branch
↓

main
Following this process consistently will keep the repository healthy, minimize merge conflicts, and allow all developers to collaborate safely on the same project.
