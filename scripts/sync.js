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
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
};

// Fetch all comments by user on Gutenberg repo
async function fetchUserComments() {
  console.log('📥 Fetching comments...');
  const comments = [];
  
  try {
    // Fetch issue comments
    const issueComments = await octokit.paginate(
      octokit.rest.issues.listCommentsForRepo,
      {
        owner: REPO_OWNER,
        repo: REPO_NAME,
        since: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // Last year
        per_page: 100
      }
    );
    
    // Filter by username
    const userComments = issueComments.filter(c => c.user?.login?.toLowerCase() === USERNAME.toLowerCase());
    
    for (const comment of userComments) {
      // Get issue/PR details
      const issueNumber = comment.issue_url.split('/').pop();
      
      comments.push({
        type: 'comment',
        number: issueNumber,
        url: comment.html_url,
        body: comment.body?.substring(0, 100) || '',
        created_at: comment.created_at,
        issue_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${issueNumber}`
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
    // Search for PRs reviewed by user
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
        merged: pr.pull_request?.merged_at ? true : false,
        created_at: pr.created_at
      });
    }
    
    console.log(`   Found ${reviews.length} reviews`);
  } catch (error) {
    console.error('Error fetching reviews:', error.message);
  }
  
  return reviews;
}

// Fetch merged PRs where user got props
async function fetchMergedWithProps() {
  console.log('📥 Fetching merged PRs with props...');
  const merged = [];
  
  try {
    // Search for merged PRs mentioning username in comments
    const searchResult = await octokit.paginate(
      octokit.rest.search.issuesAndPullRequests,
      {
        q: `repo:${REPO_OWNER}/${REPO_NAME} is:pr is:merged commenter:${USERNAME}`,
        per_page: 100
      }
    );
    
    for (const pr of searchResult) {
      // Get PR details
      const prDetails = await octokit.rest.pulls.get({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        pull_number: pr.number
      });
      
      // Check if merged and get merge commit
      if (prDetails.data.merged_at) {
        // Get commit to check for props
        const commit = await octokit.rest.repos.getCommit({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          ref: prDetails.data.merge_commit_sha
        });
        
        const commitMessage = commit.data.commit.message.toLowerCase();
        const hasProps = commitMessage.includes(USERNAME.toLowerCase()) || 
                        commitMessage.includes('props') ||
                        commit.data.commit.message.includes(USERNAME);
        
        merged.push({
          type: 'merged',
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          merged_at: prDetails.data.merged_at,
          hasProps: hasProps,
          author: prDetails.data.user?.login
        });
      }
    }
    
    console.log(`   Found ${merged.length} merged PRs`);
  } catch (error) {
    console.error('Error fetching merged PRs:', error.message);
  }
  
  return merged;
}

// Generate contributed/issues-prs.md content
function generateContributedContent(comments, reviews) {
  const allContributions = [...comments, ...reviews]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  // Group by month
  const byMonth = {};
  for (const item of allContributions) {
    const month = getMonthYear(item.created_at);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(item);
  }
  
  let content = `# My Gutenberg Contributions

## PRs Tested & Reviewed

<!-- AUTO-SYNC START - DO NOT EDIT BELOW THIS LINE -->
<!-- Last synced: ${new Date().toISOString()} -->

`;

  for (const [month, items] of Object.entries(byMonth)) {
    content += `### ${month}\n`;
    for (const item of items) {
      const icon = item.type === 'review' ? '👀' : '💬';
      const label = item.type === 'review' ? 'Review' : 'Comment';
      content += `- ${icon} [#${item.number}](${item.url || item.issue_url}) - **${label}** (${formatDate(item.created_at)})\n`;
    }
    content += '\n';
  }

  content += `<!-- AUTO-SYNC END -->

## Contribution Types
- ✅ Testing PRs locally
- ✅ Code review and feedback
- ✅ Documentation review
- ✅ Props received on merged PRs

---
**Total Contributions**: ${allContributions.length} (Auto-synced)
`;

  return content;
}

// Generate merged/prs.md content
function generateMergedContent(merged) {
  // Group by year and month
  const byYear = {};
  for (const item of merged) {
    const date = new Date(item.merged_at);
    const year = date.getFullYear();
    const month = date.toLocaleString('en-US', { month: 'long' });
    
    if (!byYear[year]) byYear[year] = {};
    if (!byYear[year][month]) byYear[year][month] = [];
    byYear[year][month].push(item);
  }
  
  let content = `# Merged PRs (Props Received)

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
        content += `- ✅ [#${pr.number}](${pr.url}) - ${pr.title}\n`;
        content += `  - **Merged**: ${formatDate(pr.merged_at)}\n`;
        content += `  - **Contribution**: Testing and feedback\n\n`;
      }
    }
  }

  content += `<!-- AUTO-SYNC END -->

---
**Total Merged**: ${merged.length} PRs
`;

  return content;
}

// Update README.md with stats
function updateReadme(comments, reviews, merged) {
  const totalContributions = comments.length + reviews.length;
  const today = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  const content = `# WordPress Gutenberg Contributions

Personal tracking for WordPress Gutenberg (Block Editor) contributions.

## Quick Navigation
- 📝 [Contributed PRs](./contributed/issues-prs.md) - All my contributions
- ✅ [Merged PRs](./merged/prs.md) - PRs merged into Gutenberg
- 🎯 [Next Targets](./next-targets/2026-goals.md) - 2026 contribution goals

## Stats (Auto-Updated)
| Metric | Count |
|--------|-------|
| 💬 Comments | ${comments.length} |
| 👀 PR Reviews | ${reviews.length} |
| ✅ Merged (Props) | ${merged.length} |
| **Total** | **${totalContributions + merged.length}** |

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
  
  // Fetch data
  const comments = await fetchUserComments();
  const reviews = await fetchUserReviews();
  const merged = await fetchMergedWithProps();
  
  console.log('\n📝 Generating files...');
  
  // Generate and write files
  const contributedContent = generateContributedContent(comments, reviews);
  fs.writeFileSync(CONTRIBUTED_FILE, contributedContent);
  console.log('   ✅ Updated contributed/issues-prs.md');
  
  const mergedContent = generateMergedContent(merged);
  fs.writeFileSync(MERGED_FILE, mergedContent);
  console.log('   ✅ Updated merged/prs.md');
  
  const readmeContent = updateReadme(comments, reviews, merged);
  fs.writeFileSync(README_FILE, readmeContent);
  console.log('   ✅ Updated README.md');
  
  console.log('\n✨ Sync complete!');
  console.log(`   📊 Total: ${comments.length} comments, ${reviews.length} reviews, ${merged.length} merged`);
}

main().catch(console.error);
