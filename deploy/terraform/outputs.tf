output "public_ip" {
  value = local.public_ip
}

output "origin" {
  description = "PUBLIC_ORIGIN of the service"
  value       = local.origin
}

output "manifest_url" {
  description = "Paste this into provider-kit check / register and stellar-pay"
  value       = "${local.origin}/.well-known/stellar-agent-services.json"
}

output "network" {
  value = var.stellar_network
}

output "ssh" {
  value = "ssh ubuntu@${local.public_ip}"
}

output "logs" {
  value = "ssh ubuntu@${local.public_ip} journalctl -u pitch-deck-agent -f"
}
