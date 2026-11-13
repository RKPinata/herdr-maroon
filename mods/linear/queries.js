// Linear GraphQL documents. Every list row uses the ROW fields.
const ROW = `id identifier title priority priorityLabel updatedAt
  state { id name type position color }`;
const OPEN = `{ state: { type: { nin: ["completed", "canceled"] } } }`;

export const MY_ISSUES = `query MyIssues {
  viewer { assignedIssues(first: 100, orderBy: updatedAt, filter: ${OPEN}) { nodes { ${ROW} } } }
}`;

export const PROJECTS = `query Projects {
  projects(first: 50, orderBy: updatedAt, filter: {
    status: { type: { nin: ["completed", "canceled"] } }
    accessibleTeams: { some: { members: { some: { isMe: { eq: true } } } } }
  }) { nodes { id name color } }
}`;

export const PROJECT_ISSUES = `query ProjectIssues($id: String!) {
  project(id: $id) { id name issues(first: 100, filter: ${OPEN}) { nodes { ${ROW} } } }
}`;

export const FAVORITES = `query Favorites {
  favorites(first: 250) {
    nodes {
      id type sortOrder folderName url parent { id }
      issue { ${ROW} }
      project { id name color }
      customView { id name color modelName }
      cycle { name number }
      document { title }
    }
  }
}`;

export const VIEW_ISSUES = `query ViewIssues($id: String!) {
  customView(id: $id) { id name issues(first: 100) { nodes { ${ROW} } } }
}`;

export const SEARCH = `query Search($term: String!) {
  searchIssues(term: $term, first: 25) { nodes { ${ROW} } }
}`;

export const BY_NUMBER = `query ByNumber($number: Float!) {
  issues(first: 25, filter: { number: { eq: $number }, team: { members: { some: { isMe: { eq: true } } } } }) {
    nodes { ${ROW} }
  }
}`;

export const BRANCH = `query Branch($branch: String!) {
  issueVcsBranchSearch(branchName: $branch) { ${ROW} }
}`;

export const TICKET = `query Ticket($id: String!) {
  viewer { id }
  issue(id: $id) {
    id identifier title url branchName priority priorityLabel description dueDate estimate
    state { id name color }
    assignee { id name }
    labels { nodes { name color } }
    project { name }
    favorite { id }
    cycle { number name }
    parent { identifier title }
    children { nodes { identifier title state { name type color } } }
    relations { nodes { type relatedIssue { identifier title state { color } } } }
    inverseRelations { nodes { type issue { identifier title state { color } } } }
    attachments { nodes { title subtitle url } }
    comments(first: 100) { nodes { id body createdAt url user { name } parent { id } } }
    team { states { nodes { id name type position color } } }
  }
}`;

export const ISSUE_UPDATE = `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}`;

export const COMMENT_CREATE = `mutation CommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) { success }
}`;

export const FAVORITE_CREATE = `mutation FavoriteCreate($input: FavoriteCreateInput!) {
  favoriteCreate(input: $input) { success }
}`;

export const FAVORITE_DELETE = `mutation FavoriteDelete($id: String!) {
  favoriteDelete(id: $id) { success }
}`;
