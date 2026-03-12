#!/usr/bin/env bash
#
# Seed SSM Parameter Store with app secrets.
# Run once before deploying the compute stack.
#
# Usage: ./scripts/seed-ssm-params.sh
#
# All values are read from environment variables.
# Export them before running or pass them inline:
#
#   JWT_SECRET=xxx SMTP_HOST=smtp.gmail.com ... ./scripts/seed-ssm-params.sh
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"

put_param() {
  local name="$1"
  local value="$2"
  local type="${3:-SecureString}"

  if [[ -z "$value" ]]; then
    echo "SKIP $name (empty)"
    return
  fi

  aws ssm put-parameter \
    --region "$REGION" \
    --name "$name" \
    --value "$value" \
    --type "$type" \
    --overwrite \
    --no-cli-pager

  echo "  OK $name"
}

echo "Seeding SSM parameters in $REGION ..."
echo ""

put_param "/gtm/jwt-secret"                  "${JWT_SECRET:-changeme}"
put_param "/gtm/smtp-host"                   "${SMTP_HOST:-smtp.gmail.com}"       String
put_param "/gtm/smtp-port"                   "${SMTP_PORT:-587}"                  String
put_param "/gtm/smtp-secure"                 "${SMTP_SECURE:-false}"              String
put_param "/gtm/smtp-user"                   "${SMTP_USER:-}"
put_param "/gtm/smtp-pass"                   "${SMTP_PASS:-}"
put_param "/gtm/smtp-from"                   "${SMTP_FROM:-}"                     String
put_param "/gtm/twilio-account-sid"          "${TWILIO_ACCOUNT_SID:-none}"
put_param "/gtm/twilio-auth-token"           "${TWILIO_AUTH_TOKEN:-none}"
put_param "/gtm/twilio-phone-number"         "${TWILIO_PHONE_NUMBER:-none}"       String
put_param "/gtm/twilio-messaging-service-sid" "${TWILIO_MESSAGING_SERVICE_SID:-none}" String

echo ""
echo "Done. Parameters stored under /gtm/*"
