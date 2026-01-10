const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

// Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || 'noruzzamans';
const REPO_OWNER = 'WordPress';
const REPO_NAME = 'gutenberg';

// Initialize Octokit
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Paths
const ROOT_DIR = path.join(__dirname, '..');
const CONTRIBUTED_FILE = path.join(ROOT_DIR, 'contributed', 'issues-prs.md');
const MERGED_FILE = path.join(ROOT_DIR, 'merged', 'prs.md');
const README_FILE = path.join(ROOT_DIR, 'README.md');

// Date helpers
const formatDate = (dateStr) => {
  const date = new Date(dateStr);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
};

const getMonthYear = (dateStr) => {
  const date = new Date(dateStr);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return { month: months[date.getMonth()], year: date.getFullYear(), key: `${months[date.getMonth()]} ${date.getFullYear()}` };
};

// Fetch all PRs/issues where user commented
async function fetchUserComments() {
  console.log('📥 Fetching comments...');
  const comments = [];

  try {
    const issueComments = await octokit.paginate(
      octokit.rest.issues.listCommentsForRepo,
      {
        owner: REPO_OWNER,
        repo: REPO_NAME,
        since: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        per_page: 100
      }
    );

    const userComments = issueComments.filter(c => c.user?.login?.toLowerCase() === USERNAME.toLowerCase());

    for (const comment of userComments) {
      const issueNumber = comment.issue_url.split('/').pop();
      comments.push({
        type: 'comment',
        number: issueNumber,
        url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${issueNumber}`,
        created_at: comment.created_at
      });
    }

    console.log(`   Found ${comments.length} comments`);
  } catch (error) {
    console.error('Error fetching comments:', error.message);
  }

  return comments;
}

// Fetch PRs reviewed by user
async function fetchUserReviews() {
  console.log('📥 Fetching reviews...');
  const reviews = [];

  try {
    const searchResult = await octokit.paginate(
      octokit.rest.search.issuesAndPullRequests,
      {
        q: `repo:${REPO_OWNER}/${REPO_NAME} is:pr reviewed-by:${USERNAME}`,
        per_page: 100
      }
    );

    for (const pr of searchResult) {
      reviews.push({
        type: 'review',
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        created_at: pr.created_at
      });
    }

    console.log(`   Found ${reviews.length} reviews`);
  } catch (error) {
    console.error('Error fetching reviews:', error.message);
  }

  return reviews;
}

// Fetch ALL PRs where user is involved (comment/review) and check props status
async function fetchAllInvolvedPRs() {
  console.log('📥 Fetching all involved PRs...');
  const involved = [];

  try {
    // Get all PRs where user commented or reviewed
    const searchResult = await octokit.paginate(
      octokit.rest.search.issuesAndPullRequests,
      {
        q: `repo:${REPO_OWNER}/${REPO_NAME} is:pr involves:${USERNAME}`,
        per_page: 100
      }
    );

    for (const pr of searchResult) {
      let hasProps = false;
      let isMerged = false;
      let mergedAt = null;
      let contributionType = 'comment';

      // Check if it's a PR we reviewed
      try {
        const reviews = await octokit.rest.pulls.listReviews({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          pull_number: pr.number
        });

        const userReviewed = reviews.data.some(r => r.user?.login?.toLowerCase() === USERNAME.toLowerCase());
        if (userReviewed) {
          contributionType = 'review';
        }
      } catch (e) {
        // Ignore review check errors
      }

      // Get PR details for merge status
      try {
        const prDetails = await octokit.rest.pulls.get({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          pull_number: pr.number
        });

        if (prDetails.data.merged_at) {
          isMerged = true;
          mergedAt = prDetails.data.merged_at;

          // Check for props in merge commit
          const commit = await octokit.rest.repos.getCommit({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            ref: prDetails.data.merge_commit_sha
          });

          hasProps = commit.data.commit.message.toLowerCase().includes(USERNAME.toLowerCase());
        }
      } catch (e) {
        // Ignore PR detail errors
      }

      involved.push({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        contributionType,
        hasProps,
        isMerged,
        mergedAt,
        created_at: pr.created_at
      });
    }

    console.log(`   Found ${involved.length} involved PRs`);
    console.log(`   - With Props: ${involved.filter(p => p.hasProps).length}`);
    console.log(`   - Without Props: ${involved.filter(p => !p.hasProps).length}`);
    console.log(`   - Merged: ${involved.filter(p => p.isMerged).length}`);
  } catch (error) {
    console.error('Error fetching involved PRs:', error.message);
  }

  return involved;
}

// Generate contributed/issues-prs.md content - ALL contributions
function generateContributedContent(allPRs) {
  // Sort by date descending
  const sorted = allPRs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Group by year then month
  const byYear = {};
  for (const item of sorted) {
    const { month, year } = getMonthYear(item.created_at);
    if (!byYear[year]) byYear[year] = {};
    if (!byYear[year][month]) byYear[year][month] = [];
    byYear[year][month].push(item);
  }

  let content = `# All My Gutenberg Contributions

This file tracks ALL PRs/issues where I'm involved (comments, reviews, props).

## Legend
- 💬 Comment - Commented on PR/Issue
- 👀 Review - Reviewed PR
- ✅ Props - Received props (merged)
- ⏳ Pending - Not yet merged / No props

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  // Sort years descending
  const years = Object.keys(byYear).sort((a, b) => b - a);

  for (const year of years) {
    content += `## ${year}\n\n`;
    const months = Object.keys(byYear[year]);

    for (const month of months) {
      content += `### ${month}\n`;
      for (const pr of byYear[year][month]) {
        const typeIcon = pr.contributionType === 'review' ? '👀' : '💬';
        const typeLabel = pr.contributionType === 'review' ? 'Review' : 'Comment';
        const propsIcon = pr.hasProps ? '✅' : '⏳';
        const propsLabel = pr.hasProps ? 'Props Received' : (pr.isMerged ? 'Merged (No Props)' : 'Open/Closed');

        content += `- ${typeIcon} [#${pr.number}](${pr.url}) - ${pr.title || 'PR'}\n`;
        content += `  - **Type**: ${typeLabel} | **Status**: ${propsIcon} ${propsLabel}\n`;
        content += `  - **Date**: ${formatDate(pr.created_at)}\n\n`;
      }
    }
  }

  const withProps = allPRs.filter(p => p.hasProps).length;
  const withoutProps = allPRs.filter(p => !p.hasProps).length;

  content += `<!-- AUTO-SYNC END -->

---
## Summary
| Category | Count |
|----------|-------|
| ✅ With Props | ${withProps} |
| ⏳ Without Props | ${withoutProps} |
| **Total** | **${allPRs.length}** |
`;

  return content;
}

// Generate merged/prs.md content - Only merged PRs with props
function generateMergedContent(allPRs) {
  const merged = allPRs.filter(p => p.isMerged && p.hasProps);

  // Group by year and month
  const byYear = {};
  for (const item of merged) {
    const date = new Date(item.mergedAt);
    const year = date.getFullYear();
    const month = date.toLocaleString('en-US', { month: 'long' });

    if (!byYear[year]) byYear[year] = {};
    if (!byYear[year][month]) byYear[year][month] = [];
    byYear[year][month].push(item);
  }

  let content = `# Merged PRs (Props Received)

Only PRs where I received props in the merge commit.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  const years = Object.keys(byYear).sort((a, b) => b - a);

  for (const year of years) {
    content += `## ${year}\n\n`;
    const months = Object.keys(byYear[year]);

    for (const month of months) {
      content += `### ${month}\n`;
      for (const pr of byYear[year][month]) {
        content += `- ✅ [#${pr.number}](${pr.url}) - ${pr.title}\n`;
        content += `  - **Merged**: ${formatDate(pr.mergedAt)}\n`;
        content += `  - **Contribution**: ${pr.contributionType === 'review' ? 'Review' : 'Comment'} & Testing\n\n`;
      }
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Merged with Props**: ${merged.length} PRs
`;

  return content;
}

// Update README.md with stats
function updateReadme(allPRs) {
  const withProps = allPRs.filter(p => p.hasProps).length;
  const withoutProps = allPRs.filter(p => !p.hasProps).length;
  const reviews = allPRs.filter(p => p.contributionType === 'review').length;
  const comments = allPRs.filter(p => p.contributionType === 'comment').length;
  const merged = allPRs.filter(p => p.isMerged && p.hasProps).length;

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const content = `# WordPress Gutenberg Contributions

Personal tracking for WordPress Gutenberg (Block Editor) contributions.

## Quick Navigation
- 📝 [All Contributions](./contributed/issues-prs.md) - Every PR I'm involved in
- ✅ [Merged PRs](./merged/prs.md) - PRs merged with my props
- 🎯 [2026 Goals](./next-targets/2026-goals.md) - Contribution goals

## Stats (Auto-Updated)
| Metric | Count |
|--------|-------|
| 👀 PR Reviews | ${reviews} |
| 💬 PR Comments | ${comments} |
| ✅ Props Received | ${withProps} |
| ⏳ No Props Yet | ${withoutProps} |
| **Total Involved** | **${allPRs.length}** |

---
**Last Synced**: ${today}
`;

  return content;
}

// Main sync function
async function main() {
  console.log('🚀 Starting Gutenberg contributions sync...\n');
  console.log(`👤 Username: ${USERNAME}`);
  console.log(`📁 Repository: ${REPO_OWNER}/${REPO_NAME}\n`);

  // Fetch ALL involved PRs with props status
  const allPRs = await fetchAllInvolvedPRs();

  console.log('\n📝 Generating files...');

  // Generate and write files
  const contributedContent = generateContributedContent(allPRs);
  fs.writeFileSync(CONTRIBUTED_FILE, contributedContent);
  console.log('   ✅ Updated contributed/issues-prs.md');

  const mergedContent = generateMergedContent(allPRs);
  fs.writeFileSync(MERGED_FILE, mergedContent);
  console.log('   ✅ Updated merged/prs.md');

  const readmeContent = updateReadme(allPRs);
  fs.writeFileSync(README_FILE, readmeContent);
  console.log('   ✅ Updated README.md');

  const withProps = allPRs.filter(p => p.hasProps).length;
  const merged = allPRs.filter(p => p.isMerged && p.hasProps).length;

  console.log('\n✨ Sync complete!');
  console.log(`   📊 Total Involved: ${allPRs.length}`);
  console.log(`   ✅ Props Received: ${withProps}`);
  console.log(`   🎯 Merged with Props: ${merged}`);
}

main().catch(console.error);
