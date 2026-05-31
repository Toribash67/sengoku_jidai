# Watchtower

Watchtower should be run once on the TrueNAS host. This stack uses label-gated updates, so only containers with `com.centurylinklabs.watchtower.enable: "true"` are updated.

The Sengoku Jidai Dockge stack opts in with that label and uses the `latest` GHCR tag built from `main`.
