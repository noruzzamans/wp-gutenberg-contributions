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
const CONTRIBUTED_DIR = path.join(ROOT_DIR, 'contributed');
const CONTRIBUTED_FILE = path.join(CONTRIBUTED_DIR, 'issues-prs.md');
const CONTRIBUTED_REVIEWS = path.join(CONTRIBUTED_DIR, 'reviews.md');
const CONTRIBUTED_COMMENTS = path.join(CONTRIBUTED_DIR, 'comments.md');
const CONTRIBUTED_WITH_PROPS = path.join(CONTRIBUTED_DIR, 'with-props.md');
const CONTRIBUTED_WITHOUT_PROPS = path.join(CONTRIBUTED_DIR, 'without-props.md');
const CONTRIBUTED_PROPS_WAITING = path.join(CONTRIBUTED_DIR, 'props-waiting.md');
const CONTRIBUTED_CLOSED_NO_PROPS = path.join(CONTRIBUTED_DIR, 'closed-no-props.md');
const CONTRIBUTED_MERGED_NO_PROPS = path.join(CONTRIBUTED_DIR, 'merged-no-props.md');
const MERGED_FILE = path.join(ROOT_DIR, 'merged', 'prs.md');
const README_FILE = path.join(ROOT_DIR, 'README.md');
const MY_PRS_DIR = path.join(ROOT_DIR, 'my-prs');
const MY_PRS_OPEN = path.join(MY_PRS_DIR, 'open.md');
const MY_PRS_CLOSED = path.join(MY_PRS_DIR, 'closed.md');
const MY_PRS_MERGED = path.join(MY_PRS_DIR, 'merged.md');

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

// Fetch PRs authored by user (my own PRs)
async function fetchMyAuthoredPRs() {
  console.log('📥 Fetching my authored PRs...');
  const myPRs = [];

  try {
    // Search for all PRs authored by user
    const searchResult = await octokit.paginate(
      octokit.rest.search.issuesAndPullRequests,
      {
        q: `repo:${REPO_OWNER}/${REPO_NAME} is:pr author:${USERNAME}`,
        per_page: 100
      }
    );

    for (const pr of searchResult) {
      let isMerged = false;
      let mergedAt = null;
      let closedAt = null;

      // Get PR details
      try {
        const prDetails = await octokit.rest.pulls.get({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          pull_number: pr.number
        });

        if (prDetails.data.merged_at) {
          isMerged = true;
          mergedAt = prDetails.data.merged_at;
        }
        if (prDetails.data.closed_at) {
          closedAt = prDetails.data.closed_at;
        }
      } catch (e) {
        // Ignore errors
      }

      myPRs.push({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state, // 'open' or 'closed'
        isMerged,
        mergedAt,
        closedAt,
        created_at: pr.created_at
      });
    }

    const open = myPRs.filter(p => p.state === 'open').length;
    const closed = myPRs.filter(p => p.state === 'closed' && !p.isMerged).length;
    const merged = myPRs.filter(p => p.isMerged).length;

    console.log(`   Found ${myPRs.length} authored PRs`);
    console.log(`   - Open: ${open}`);
    console.log(`   - Closed: ${closed}`);
    console.log(`   - Merged: ${merged}`);
  } catch (error) {
    console.error('Error fetching authored PRs:', error.message);
  }

  return myPRs;
}

// Generate my-prs/open.md
function generateMyOpenPRs(myPRs) {
  const open = myPRs.filter(p => p.state === 'open');

  let content = `# My Authored PRs (Open)

PRs I submitted to Gutenberg that are still open.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (open.length === 0) {
    content += `*No open PRs*\n\n`;
  } else {
    for (const pr of open) {
      content += `- 🟡 [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Created**: ${formatDate(pr.created_at)}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Open**: ${open.length} PRs
`;

  return content;
}

// Generate my-prs/closed.md
function generateMyClosedPRs(myPRs) {
  const closed = myPRs.filter(p => p.state === 'closed' && !p.isMerged);

  let content = `# My Authored PRs (Closed)

PRs I submitted to Gutenberg that were closed without merging.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (closed.length === 0) {
    content += `*No closed PRs*\n\n`;
  } else {
    for (const pr of closed) {
      content += `- ❌ [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Created**: ${formatDate(pr.created_at)}\n`;
      content += `  - **Closed**: ${formatDate(pr.closedAt)}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Closed**: ${closed.length} PRs
`;

  return content;
}

// Generate my-prs/merged.md
function generateMyMergedPRs(myPRs) {
  const merged = myPRs.filter(p => p.isMerged);

  let content = `# My Authored PRs (Merged)

PRs I submitted to Gutenberg that got merged.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (merged.length === 0) {
    content += `*No merged PRs yet*\n\n`;
  } else {
    for (const pr of merged) {
      content += `- ✅ [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Merged**: ${formatDate(pr.mergedAt)}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Merged**: ${merged.length} PRs
`;

  return content;
}

// Generate contributed/reviews.md
function generateReviewsFile(allPRs) {
  const reviews = allPRs.filter(p => p.contributionType === 'review');

  let content = `# PR Reviews

PRs where I submitted a review.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (reviews.length === 0) {
    content += `*No reviews yet*\n\n`;
  } else {
    for (const pr of reviews) {
      const propsIcon = pr.hasProps ? '✅' : '⏳';
      content += `- 👀 [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Date**: ${formatDate(pr.created_at)} | **Props**: ${propsIcon}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Reviews**: ${reviews.length} PRs
`;

  return content;
}

// Generate contributed/comments.md
function generateCommentsFile(allPRs) {
  const comments = allPRs.filter(p => p.contributionType === 'comment');

  let content = `# PR Comments

PRs where I left comments.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (comments.length === 0) {
    content += `*No comments yet*\n\n`;
  } else {
    for (const pr of comments) {
      const propsIcon = pr.hasProps ? '✅' : '⏳';
      content += `- 💬 [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Date**: ${formatDate(pr.created_at)} | **Props**: ${propsIcon}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Comments**: ${comments.length} PRs
`;

  return content;
}

// Generate contributed/with-props.md
function generateWithPropsFile(allPRs) {
  const withProps = allPRs.filter(p => p.hasProps);

  let content = `# Props Received

PRs where I received props in the merge commit.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (withProps.length === 0) {
    content += `*No props received yet*\n\n`;
  } else {
    for (const pr of withProps) {
      const typeIcon = pr.contributionType === 'review' ? '👀' : '💬';
      content += `- ✅ [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Contribution**: ${typeIcon} ${pr.contributionType === 'review' ? 'Review' : 'Comment'}\n`;
      content += `  - **Date**: ${formatDate(pr.created_at)}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Props Received**: ${withProps.length} PRs
`;

  return content;
}

// Generate contributed/without-props.md
function generateWithoutPropsFile(allPRs) {
  const withoutProps = allPRs.filter(p => !p.hasProps);

  let content = `# No Props Yet

PRs where I contributed but haven't received props yet.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (withoutProps.length === 0) {
    content += `*All contributions have received props!*\n\n`;
  } else {
    for (const pr of withoutProps) {
      const typeIcon = pr.contributionType === 'review' ? '👀' : '💬';
      const status = pr.isMerged ? 'Merged (No Props)' : 'Open/Closed';
      content += `- ⏳ [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Contribution**: ${typeIcon} ${pr.contributionType === 'review' ? 'Review' : 'Comment'}\n`;
      content += `  - **Date**: ${formatDate(pr.created_at)} | **Status**: ${status}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Without Props**: ${withoutProps.length} PRs
`;

  return content;
}

// Generate contributed/props-waiting.md - Open PRs waiting for merge
function generatePropsWaitingFile(allPRs) {
  const waiting = allPRs.filter(p => !p.hasProps && p.state === 'open');

  let content = `# 🔄 Props Waiting

PRs that are still **open** - will receive props when merged.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (waiting.length === 0) {
    content += `*No open PRs waiting for props*\n\n`;
  } else {
    for (const pr of waiting) {
      const typeIcon = pr.contributionType === 'review' ? '👀' : '💬';
      content += `- 🔄 [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Contribution**: ${typeIcon} ${pr.contributionType === 'review' ? 'Review' : 'Comment'}\n`;
      content += `  - **Date**: ${formatDate(pr.created_at)}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Props Waiting**: ${waiting.length} PRs
`;

  return content;
}

// Generate contributed/closed-no-props.md - Closed PRs without merge
function generateClosedNoPropsFile(allPRs) {
  const closed = allPRs.filter(p => !p.hasProps && p.state === 'closed' && !p.isMerged);

  let content = `# ❌ Closed (No Props)

PRs that were **closed without being merged** - no props possible.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (closed.length === 0) {
    content += `*No closed PRs*\n\n`;
  } else {
    for (const pr of closed) {
      const typeIcon = pr.contributionType === 'review' ? '👀' : '💬';
      content += `- ❌ [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Contribution**: ${typeIcon} ${pr.contributionType === 'review' ? 'Review' : 'Comment'}\n`;
      content += `  - **Date**: ${formatDate(pr.created_at)}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Closed**: ${closed.length} PRs
`;

  return content;
}

// Generate contributed/merged-no-props.md - Merged but no props
function generateMergedNoPropsFile(allPRs) {
  const mergedNoProps = allPRs.filter(p => !p.hasProps && p.isMerged);

  let content = `# 🤔 Merged (No Props)

PRs that were **merged** but I didn't receive props in the commit message.

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  if (mergedNoProps.length === 0) {
    content += `*All merged PRs have given props!*\n\n`;
  } else {
    for (const pr of mergedNoProps) {
      const typeIcon = pr.contributionType === 'review' ? '👀' : '💬';
      content += `- 🤔 [#${pr.number}](${pr.url}) - ${pr.title}\n`;
      content += `  - **Contribution**: ${typeIcon} ${pr.contributionType === 'review' ? 'Review' : 'Comment'}\n`;
      content += `  - **Date**: ${formatDate(pr.created_at)}\n`;
      content += `  - **Merged**: ${pr.mergedAt ? formatDate(pr.mergedAt) : 'Unknown'}\n\n`;
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Merged (No Props)**: ${mergedNoProps.length} PRs
`;

  return content;
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
function updateReadme(allPRs, myPRs = []) {
  const withProps = allPRs.filter(p => p.hasProps).length;
  const reviews = allPRs.filter(p => p.contributionType === 'review').length;
  const comments = allPRs.filter(p => p.contributionType === 'comment').length;

  // New props categories
  const propsWaiting = allPRs.filter(p => !p.hasProps && p.state === 'open').length;
  const closedNoProps = allPRs.filter(p => !p.hasProps && p.state === 'closed' && !p.isMerged).length;
  const mergedNoProps = allPRs.filter(p => !p.hasProps && p.isMerged).length;

  const myOpen = myPRs.filter(p => p.state === 'open').length;
  const myClosed = myPRs.filter(p => p.state === 'closed' && !p.isMerged).length;
  const myMerged = myPRs.filter(p => p.isMerged).length;

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const content = `# WordPress Gutenberg Contributions

Personal tracking for WordPress Gutenberg (Block Editor) contributions.

## Quick Navigation

### 📊 Contributions (on others' PRs)
- 📝 [All Contributions](./contributed/issues-prs.md) - Every PR I'm involved in
- 👀 [PR Reviews](./contributed/reviews.md) - PRs I reviewed
- 💬 [PR Comments](./contributed/comments.md) - PRs I commented on
- ✅ [Props Received](./contributed/with-props.md) - PRs where I got props
- 🔄 [Props Waiting](./contributed/props-waiting.md) - Open PRs, will get props when merged
- ❌ [Closed (No Props)](./contributed/closed-no-props.md) - Closed without merge
- 🤔 [Merged (No Props)](./contributed/merged-no-props.md) - Merged but no props received

### 📁 My Authored PRs
- 🟡 [Open PRs](./my-prs/open.md) - My PRs still open
- ❌ [Closed PRs](./my-prs/closed.md) - My PRs closed without merge
- ✅ [Merged PRs](./my-prs/merged.md) - My PRs that got merged

### 🎯 Goals
- [2026 Goals](./next-targets/2026-goals.md) - Contribution goals

## Stats (Auto-Updated)

<table width="100%">
<tr>
<td width="50%" valign="top">

### 📊 Contributions on Others' PRs
| Metric | Count |
|--------|-------|
| [👀 PR Reviews](./contributed/reviews.md) | ${reviews} |
| [💬 PR Comments](./contributed/comments.md) | ${comments} |
| [✅ Props Received](./contributed/with-props.md) | ${withProps} |
| [🔄 Props Waiting](./contributed/props-waiting.md) | ${propsWaiting} |
| [❌ Closed (No Props)](./contributed/closed-no-props.md) | ${closedNoProps} |
| [🤔 Merged (No Props)](./contributed/merged-no-props.md) | ${mergedNoProps} |
| **Total Involved** | **${allPRs.length}** |

</td>
<td width="50%" valign="top">

### 📁 My Authored PRs
| Status | Count |
|--------|-------|
| [🟡 Open](./my-prs/open.md) | ${myOpen} |
| [❌ Closed](./my-prs/closed.md) | ${myClosed} |
| [✅ Merged](./my-prs/merged.md) | ${myMerged} |
| **Total** | **${myPRs.length}** |

### 🎯 Achievement Highlights
| Metric | Value |
|--------|-------|
| 📈 Props Rate | ${withProps}/${allPRs.length} (${Math.round((withProps / allPRs.length) * 100) || 0}%) |
| 🎉 Total Contributions | ${allPRs.length + myPRs.length} |
| 🚀 Active Areas | Reviews, Comments |

</td>
</tr>
</table>

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

  // Fetch my authored PRs
  const myPRs = await fetchMyAuthoredPRs();

  console.log('\n📝 Generating files...');

  // Ensure directories exist
  if (!fs.existsSync(MY_PRS_DIR)) {
    fs.mkdirSync(MY_PRS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONTRIBUTED_DIR)) {
    fs.mkdirSync(CONTRIBUTED_DIR, { recursive: true });
  }

  // Generate contributed files
  fs.writeFileSync(CONTRIBUTED_FILE, generateContributedContent(allPRs));
  console.log('   ✅ Updated contributed/issues-prs.md');

  fs.writeFileSync(CONTRIBUTED_REVIEWS, generateReviewsFile(allPRs));
  console.log('   ✅ Updated contributed/reviews.md');

  fs.writeFileSync(CONTRIBUTED_COMMENTS, generateCommentsFile(allPRs));
  console.log('   ✅ Updated contributed/comments.md');

  fs.writeFileSync(CONTRIBUTED_WITH_PROPS, generateWithPropsFile(allPRs));
  console.log('   ✅ Updated contributed/with-props.md');

  fs.writeFileSync(CONTRIBUTED_WITHOUT_PROPS, generateWithoutPropsFile(allPRs));
  console.log('   ✅ Updated contributed/without-props.md');

  fs.writeFileSync(CONTRIBUTED_PROPS_WAITING, generatePropsWaitingFile(allPRs));
  console.log('   ✅ Updated contributed/props-waiting.md');

  fs.writeFileSync(CONTRIBUTED_CLOSED_NO_PROPS, generateClosedNoPropsFile(allPRs));
  console.log('   ✅ Updated contributed/closed-no-props.md');

  fs.writeFileSync(CONTRIBUTED_MERGED_NO_PROPS, generateMergedNoPropsFile(allPRs));
  console.log('   ✅ Updated contributed/merged-no-props.md');

  // Generate merged file
  fs.writeFileSync(MERGED_FILE, generateMergedContent(allPRs));
  console.log('   ✅ Updated merged/prs.md');

  // Generate my-prs files
  fs.writeFileSync(MY_PRS_OPEN, generateMyOpenPRs(myPRs));
  console.log('   ✅ Updated my-prs/open.md');

  fs.writeFileSync(MY_PRS_CLOSED, generateMyClosedPRs(myPRs));
  console.log('   ✅ Updated my-prs/closed.md');

  fs.writeFileSync(MY_PRS_MERGED, generateMyMergedPRs(myPRs));
  console.log('   ✅ Updated my-prs/merged.md');

  // Generate README
  fs.writeFileSync(README_FILE, updateReadme(allPRs, myPRs));
  console.log('   ✅ Updated README.md');

  const withProps = allPRs.filter(p => p.hasProps).length;
  const merged = allPRs.filter(p => p.isMerged && p.hasProps).length;
  const myOpen = myPRs.filter(p => p.state === 'open').length;
  const myClosed = myPRs.filter(p => p.state === 'closed' && !p.isMerged).length;
  const myMerged = myPRs.filter(p => p.isMerged).length;

  console.log('\n✨ Sync complete!');
  console.log(`   📊 Total Involved: ${allPRs.length}`);
  console.log(`   ✅ Props Received: ${withProps}`);
  console.log(`   🎯 Merged with Props: ${merged}`);
  console.log(`   📝 My PRs: ${myPRs.length} (Open: ${myOpen}, Closed: ${myClosed}, Merged: ${myMerged})`);
}

main().catch(console.error);

