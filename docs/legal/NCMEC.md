# NCMEC Registration & CyberTipline Integration

## Status: Pre-registration

Martol allows user-uploaded images in chat rooms. Before enabling public uploads, NCMEC registration is required under 18 U.S.C. § 2258A.

## Registration Checklist

- [ ] Register as an Electronic Service Provider (ESP) at https://report.cybertip.org/ispregistration/
- [ ] Designate a company contact for CyberTipline reports
- [ ] Obtain ESP credentials (API key + org ID)
- [ ] Implement CyberTipline API integration for automated reporting
- [ ] Establish internal review process for flagged content
- [ ] Document retention policy (90 days minimum per federal law)
- [ ] Train designated staff on reporting obligations

## CyberTipline API Integration

When CSAM is detected (via AI scan or user report with `reason: 'csam'`):

1. **Preserve evidence**: Copy flagged R2 object to a quarantine bucket (separate from user-accessible storage)
2. **Submit CyberTipline report** via API: https://report.cybertip.org/api/
   - Include: file hash (SHA-256), upload timestamp, uploader IP, user agent
   - Include: original filename, content type, file size
   - Do NOT notify the uploader that a report was filed
3. **Restrict account**: Apply immediate suspension sanction via `user_sanctions` table
4. **Retain records**: Preserve report metadata for minimum 90 days

## Legal Requirements

- **18 U.S.C. § 2258A**: ESPs must report apparent CSAM to NCMEC
- **Preservation**: Must preserve content and user data related to reports for 90 days (or longer if requested by law enforcement)
- **No notification**: Do NOT notify users that a CyberTipline report was filed about their content
- **Hashing**: Consider integrating PhotoDNA or similar perceptual hashing for known CSAM detection

## Implementation Notes

- Current image scanning uses `@cf/microsoft/resnet-50` for general classification
- For production CSAM detection, integrate a dedicated moderation model or PhotoDNA
- The `content_reports` table already tracks `reason: 'csam'` reports
- The `user_sanctions` table supports immediate account suspension
- R2 quarantine bucket should be separate from `STORAGE` with restricted access

## Timeline

1. Complete NCMEC registration (requires legal review)
2. Implement CyberTipline API client
3. Add quarantine R2 bucket to wrangler.toml
4. Wire CSAM detection → CyberTipline report → account suspension pipeline
5. Enable public uploads only after steps 1-4 are complete
