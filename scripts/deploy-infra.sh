#!/usr/bin/env bash
#
# Deploy GTM backend infrastructure via CloudFormation.
#
# Usage:
#   ./scripts/deploy-infra.sh                  # deploy all stacks
#   ./scripts/deploy-infra.sh network           # deploy only network
#   ./scripts/deploy-infra.sh database          # deploy only database
#   ./scripts/deploy-infra.sh compute           # deploy only compute
#   ./scripts/deploy-infra.sh ci                # deploy only CI/CD
#
set -euo pipefail

ENV="${GTM_ENV:-gtm}"
REGION="${AWS_REGION:-us-east-1}"
INFRA_DIR="$(cd "$(dirname "$0")/../infra" && pwd)"

# ── Helpers ──

deploy_stack() {
  local stack_name="$1"
  local template="$2"
  shift 2

  echo ">>> Deploying $stack_name ..."
  aws cloudformation deploy \
    --stack-name "$stack_name" \
    --template-file "$template" \
    --region "$REGION" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    "$@"
  echo "<<< $stack_name done."
}

wait_stack() {
  local stack_name="$1"
  echo "    Waiting for $stack_name to complete..."
  aws cloudformation wait stack-create-complete \
    --stack-name "$stack_name" \
    --region "$REGION" 2>/dev/null || \
  aws cloudformation wait stack-update-complete \
    --stack-name "$stack_name" \
    --region "$REGION" 2>/dev/null || true
}

# ── Stack deployments ──

deploy_network() {
  deploy_stack "${ENV}-network" "$INFRA_DIR/network.yaml" \
    --parameter-overrides "EnvironmentName=$ENV"
}

deploy_database() {
  deploy_stack "${ENV}-database" "$INFRA_DIR/database.yaml" \
    --parameter-overrides "EnvironmentName=$ENV"
}

deploy_compute() {
  if [[ -z "${KEY_PAIR:-}" ]]; then
    echo "ERROR: Set KEY_PAIR env var (e.g. KEY_PAIR=my-key ./scripts/deploy-infra.sh compute)"
    exit 1
  fi
  if [[ -z "${DOMAIN:-}" ]]; then
    echo "ERROR: Set DOMAIN env var (e.g. DOMAIN=api.example.com)"
    exit 1
  fi
  if [[ -z "${ECR_IMAGE:-}" ]]; then
    echo "ERROR: Set ECR_IMAGE env var (e.g. ECR_IMAGE=123456.dkr.ecr.us-east-1.amazonaws.com/gtm-backend:latest)"
    exit 1
  fi

  deploy_stack "${ENV}-compute" "$INFRA_DIR/compute.yaml" \
    --parameter-overrides \
      "EnvironmentName=$ENV" \
      "KeyPairName=$KEY_PAIR" \
      "DomainName=$DOMAIN" \
      "LetsEncryptEmail=${LETSENCRYPT_EMAIL:-admin@${DOMAIN}}" \
      "ECRImageUri=$ECR_IMAGE" \
      "FrontendUrl=${FRONTEND_URL:-https://${DOMAIN}}"
}

deploy_ci() {
  if [[ -z "${GITHUB_ORG:-}" ]]; then
    echo "ERROR: Set GITHUB_ORG env var"
    exit 1
  fi
  if [[ -z "${GITHUB_REPO:-}" ]]; then
    echo "ERROR: Set GITHUB_REPO env var"
    exit 1
  fi

  deploy_stack "${ENV}-ci" "$INFRA_DIR/ci.yaml" \
    --parameter-overrides \
      "EnvironmentName=$ENV" \
      "GitHubOrg=$GITHUB_ORG" \
      "GitHubRepo=$GITHUB_REPO" \
      "GitHubBranch=${GITHUB_BRANCH:-main}"
}

# ── Main ──

TARGET="${1:-all}"

case "$TARGET" in
  network)  deploy_network ;;
  database) deploy_database ;;
  compute)  deploy_compute ;;
  ci)       deploy_ci ;;
  all)
    deploy_network
    deploy_database
    deploy_ci
    echo ""
    echo "=== Network + Database + CI deployed ==="
    echo "Next steps:"
    echo "  1. Push a Docker image to ECR"
    echo "  2. Create SSM parameters (see DEPLOY.md)"
    echo "  3. Deploy compute stack:"
    echo "     KEY_PAIR=xxx DOMAIN=api.example.com ECR_IMAGE=xxx ./scripts/deploy-infra.sh compute"
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [network|database|compute|ci|all]"
    exit 1
    ;;
esac
